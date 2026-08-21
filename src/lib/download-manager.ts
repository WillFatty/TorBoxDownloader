import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { getEpisodeTitleMap } from "./cinemeta";
import { extensionFromStream, hashToMagnet } from "./comet";
import {
  describeEpisodeBatch,
  listEpisodeVideos,
  type EpisodeFile,
} from "./episodes";
import { buildJellyfinPaths } from "./naming";
import { getSettings, libraryRootFor } from "./settings";
import {
  createTorrent,
  getTorrentById,
  isTorrentReady,
  isTransientTorBoxError,
  normalizeTorrentProgress,
  pickBestVideoFile,
  requestDownloadLink,
  type TorBoxFile,
  type TorBoxTorrent,
} from "./torbox";
import type { CreateDownloadInput, DownloadJob, DownloadStatus } from "./types";

const JOBS_FILE = path.join(process.cwd(), "data", "jobs.json");

async function loadEpisodeTitleMap(
  imdbId: string | null | undefined,
  preloaded?: Record<string, string> | null,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (preloaded) {
    for (const [key, title] of Object.entries(preloaded)) {
      if (title?.trim()) map.set(key, title.trim());
    }
  }
  if (!imdbId) return map;
  try {
    const remote = await getEpisodeTitleMap(imdbId);
    for (const [key, title] of Object.entries(remote)) {
      if (!map.has(key) && title.trim()) map.set(key, title.trim());
    }
  } catch {
    // optional
  }
  return map;
}

type Listener = (job: DownloadJob) => void;

class DownloadManager {
  private jobs = new Map<string, DownloadJob>();
  private running = new Set<string>();
  private listeners = new Set<Listener>();
  private loaded = false;
  /** Ephemeral: episode title maps keyed by job id (not persisted) */
  private titleMaps = new Map<string, Record<string, string>>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(job: DownloadJob) {
    for (const fn of this.listeners) fn(job);
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(JOBS_FILE, "utf8");
      const list = JSON.parse(raw) as DownloadJob[];
      for (const job of list) {
        if (!job.savedFiles) job.savedFiles = [];
        if (job.multiEpisode == null) job.multiEpisode = false;
        if (job.packSummary === undefined) job.packSummary = null;
        if (job.episodeTitle === undefined) job.episodeTitle = null;
        if (job.imdbId === undefined) job.imdbId = null;
        if (job.speedBytesPerSec == null) job.speedBytesPerSec = 0;
        this.jobs.set(job.id, job);
        if (
          job.status !== "completed" &&
          job.status !== "failed" &&
          job.status !== "cancelled"
        ) {
          this.patch(job.id, {
            status: "failed",
            error: "Interrupted by server restart",
          });
        }
      }
    } catch {
      // no jobs yet
    }
  }

  private async persist() {
    await fs.mkdir(path.dirname(JOBS_FILE), { recursive: true });
    const list = [...this.jobs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    await fs.writeFile(JOBS_FILE, JSON.stringify(list, null, 2), "utf8");
  }

  private patch(
    id: string,
    partial: Partial<DownloadJob> & { status?: DownloadStatus },
  ) {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, partial, { updatedAt: new Date().toISOString() });
    this.jobs.set(id, job);
    void this.persist();
    this.emit(job);
  }

  async list(): Promise<DownloadJob[]> {
    await this.load();
    return [...this.jobs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async get(id: string): Promise<DownloadJob | null> {
    await this.load();
    return this.jobs.get(id) || null;
  }

  async enqueue(input: CreateDownloadInput): Promise<DownloadJob> {
    await this.load();
    const settings = await getSettings();
    if (!settings.torboxApiKey) {
      throw new Error("TorBox API key missing. Set it in Settings.");
    }
    if (!settings.moviesPath || !settings.tvShowsPath) {
      throw new Error("Movies / TV-Shows paths missing. Set them in Settings.");
    }

    const ext =
      input.extension ||
      extensionFromStream({
        filename: input.customFileName,
        title: input.mediaName,
      });

    const jelly = buildJellyfinPaths({
      mediaName: input.mediaName,
      year: input.year,
      mediaType: input.mediaType,
      season: input.season,
      episode: input.episode,
      episodeTitle: input.episodeTitle,
      quality: input.quality,
      extension: ext,
      customFileName: input.customFileName,
      useAutoName: input.useAutoName,
    });

    const libraryRoot = libraryRootFor(settings, input.mediaType);
    const absolutePath = path.join(libraryRoot, jelly.relativePath);

    const now = new Date().toISOString();
    const job: DownloadJob = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "queued",
      progress: 0,
      error: null,
      mediaName: input.mediaName,
      mediaType: input.mediaType,
      imdbId: input.imdbId?.trim() || null,
      year: input.year,
      season: input.season ?? null,
      episode: input.episode ?? null,
      episodeTitle: input.episodeTitle ?? null,
      quality: input.quality,
      infoHash: input.infoHash.toLowerCase(),
      fileName: jelly.fileName,
      downloadPath: absolutePath,
      torboxTorrentId: null,
      torboxFileId: null,
      bytesDownloaded: 0,
      bytesTotal: 0,
      speedBytesPerSec: 0,
      multiEpisode: false,
      savedFiles: [],
      packSummary: null,
    };

    if (input.episodeTitles && Object.keys(input.episodeTitles).length) {
      this.titleMaps.set(job.id, input.episodeTitles);
    }

    this.jobs.set(job.id, job);
    await this.persist();
    this.emit(job);
    void this.run(job.id, input.fileIdx);
    return job;
  }

  private async run(jobId: string, fileIdx: number | null) {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);

    try {
      const settings = await getSettings();
      const job = this.jobs.get(jobId);
      if (!job) return;

      this.patch(jobId, { status: "creating", progress: 5 });
      const magnet = hashToMagnet(job.infoHash);
      const created = await createTorrent(
        settings.torboxApiKey,
        magnet,
        job.mediaName,
      );
      this.patch(jobId, {
        torboxTorrentId: created.torrent_id,
        status: "torbox_downloading",
        progress: 15,
      });

      const torrent = await this.waitForReady(
        settings.torboxApiKey,
        created.torrent_id,
        jobId,
      );
      if (!torrent) return;

      const episodeFiles = listEpisodeVideos(torrent.files);

      if (job.mediaType === "series" && episodeFiles.length > 1) {
        await this.saveEpisodePack(
          jobId,
          settings.torboxApiKey,
          created.torrent_id,
          episodeFiles,
          settings.tvShowsPath,
        );
        return;
      }

      // Prefer matching requested SxxExx when pack has many but we only want one
      let file: TorBoxFile | null = null;
      if (job.mediaType === "series" && episodeFiles.length === 1) {
        file = episodeFiles[0].file;
      } else if (
        job.mediaType === "series" &&
        job.season != null &&
        job.episode != null
      ) {
        const match = episodeFiles.find(
          (e) => e.season === job.season && e.episode === job.episode,
        );
        file = match?.file || null;
      }
      if (!file) {
        file = pickBestVideoFile(torrent.files, fileIdx);
      }
      if (!file) {
        throw new Error("No video file found in TorBox torrent");
      }

      // If series file has SxxExx, retarget path to that episode
      let destPath = job.downloadPath;
      let fileName = job.fileName;
      const root = libraryRootFor(settings, job.mediaType);
      if (job.mediaType === "series") {
        const parsed = episodeFiles.find((e) => e.file.id === file!.id);
        if (parsed) {
          const titles = await loadEpisodeTitleMap(
            job.imdbId,
            this.titleMaps.get(jobId),
          );
          const epTitle =
            titles.get(`${parsed.season}:${parsed.episode}`) ||
            (parsed.season === job.season && parsed.episode === job.episode
              ? job.episodeTitle
              : null);
          const jelly = buildJellyfinPaths({
            mediaName: job.mediaName,
            year: job.year,
            mediaType: "series",
            season: parsed.season,
            episode: parsed.episode,
            episodeTitle: epTitle,
            quality: job.quality,
            extension: parsed.ext,
            useAutoName: true,
          });
          destPath = path.join(root, jelly.relativePath);
          fileName = jelly.fileName;
        }
      }

      this.patch(jobId, {
        torboxFileId: file.id,
        bytesTotal: file.size,
        status: "fetching_link",
        progress: 70,
        fileName,
        downloadPath: destPath,
        season: episodeFiles.find((e) => e.file.id === file!.id)?.season ?? job.season,
        episode:
          episodeFiles.find((e) => e.file.id === file!.id)?.episode ?? job.episode,
      });

      const link = await requestDownloadLink(
        settings.torboxApiKey,
        created.torrent_id,
        file.id,
      );

      this.patch(jobId, { status: "saving", progress: 75 });
      await this.saveFile(jobId, link, destPath, file.size, 75, 99);

      this.patch(jobId, {
        status: "completed",
        progress: 100,
        bytesDownloaded: file.size,
        savedFiles: [destPath],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      this.patch(jobId, { status: "failed", error: message });
    } finally {
      this.running.delete(jobId);
    }
  }

  private async saveEpisodePack(
    jobId: string,
    apiKey: string,
    torrentId: number,
    episodes: EpisodeFile[],
    tvShowsRoot: string,
  ) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const summary = describeEpisodeBatch(episodes);
    const totalBytes = episodes.reduce((sum, e) => sum + (e.file.size || 0), 0);
    this.patch(jobId, {
      multiEpisode: true,
      packSummary: summary,
      bytesTotal: totalBytes,
      status: "saving",
      progress: 70,
      fileName: `${job.mediaName} — ${summary}`,
      downloadPath: path.join(tvShowsRoot, job.mediaName),
    });

    const titles = await loadEpisodeTitleMap(
      job.imdbId,
      this.titleMaps.get(jobId),
    );
    // Seed selected episode title if map somehow empty
    if (job.season != null && job.episode != null && job.episodeTitle) {
      const key = `${job.season}:${job.episode}`;
      if (!titles.has(key)) titles.set(key, job.episodeTitle);
    }
    const saved: string[] = [];
    let downloadedBytes = 0;

    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      const epTitle = titles.get(`${ep.season}:${ep.episode}`) || null;
      const jelly = buildJellyfinPaths({
        mediaName: job.mediaName,
        year: job.year,
        mediaType: "series",
        season: ep.season,
        episode: ep.episode,
        episodeTitle: epTitle,
        quality: job.quality,
        extension: ep.ext,
        useAutoName: true,
      });
      const dest = path.join(tvShowsRoot, jelly.relativePath);

      this.patch(jobId, {
        status: "fetching_link",
        torboxFileId: ep.file.id,
        fileName: jelly.fileName,
        downloadPath: dest,
        season: ep.season,
        episode: ep.episode,
      });

      const link = await requestDownloadLink(apiKey, torrentId, ep.file.id);
      const startPct = 70 + Math.round((i / episodes.length) * 28);
      const endPct = 70 + Math.round(((i + 1) / episodes.length) * 28);

      this.patch(jobId, { status: "saving", progress: startPct });
      await this.saveFile(jobId, link, dest, ep.file.size, startPct, endPct);

      downloadedBytes += ep.file.size;
      saved.push(dest);
      this.patch(jobId, {
        savedFiles: [...saved],
        bytesDownloaded: downloadedBytes,
        progress: endPct,
        packSummary: `${summary} · saved ${saved.length}/${episodes.length}`,
      });

      // Brief pause between pack files so requestdl isn't hammered
      if (i < episodes.length - 1) await sleep(750);
    }

    this.patch(jobId, {
      status: "completed",
      progress: 100,
      savedFiles: saved,
      packSummary: `Saved ${saved.length} episodes (${summary})`,
      fileName: `${job.mediaName} — ${saved.length} episodes`,
      downloadPath: path.join(tvShowsRoot, job.mediaName),
    });
    this.titleMaps.delete(jobId);
  }

  private async waitForReady(
    apiKey: string,
    torrentId: number,
    jobId: string,
    timeoutMs = 45 * 60 * 1000,
  ): Promise<TorBoxTorrent | null> {
    const start = Date.now();
    // Always bypass TorBox's 10‑minute mylist cache while waiting — otherwise
    // we sit at 15% long after TorBox has finished. Retries handle DB blips.
    const pollMs = 2500;

    while (Date.now() - start < timeoutMs) {
      const current = this.jobs.get(jobId);
      if (!current || current.status === "cancelled") return null;

      try {
        const torrent = await getTorrentById(apiKey, torrentId, {
          bypassCache: true,
        });

        if (!torrent) {
          await sleep(pollMs);
          continue;
        }

        const frac = normalizeTorrentProgress(torrent.progress);
        const progress = Math.min(65, 15 + Math.round(frac * 50));
        this.patch(jobId, {
          progress,
          bytesTotal: torrent.size || current.bytesTotal,
          status: "torbox_downloading",
        });

        if (isTorrentReady(torrent) && torrent.files?.length) {
          return torrent;
        }

        // Ready but file list not populated yet — short retry
        if (isTorrentReady(torrent) && !torrent.files?.length) {
          await sleep(1000);
          continue;
        }
      } catch (err) {
        if (isTransientTorBoxError(err)) {
          await sleep(Math.min(8_000, pollMs * 2));
          continue;
        }
        throw err;
      }

      await sleep(pollMs);
    }
    throw new Error("Timed out waiting for TorBox torrent");
  }

  private async saveFile(
    jobId: string,
    url: string,
    destPath: string,
    expectedSize: number,
    progressStart = 75,
    progressEnd = 99,
  ) {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const tmp = `${destPath}.part`;

    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(`File download failed (${res.status})`);
    }

    const total = Number(res.headers.get("content-length")) || expectedSize || 0;
    let downloaded = 0;
    const self = this;
    const span = Math.max(1, progressEnd - progressStart);
    let lastTick = Date.now();
    let lastBytes = 0;
    let speed = 0;
    let lastPatch = 0;

    const nodeStream = Readable.fromWeb(
      res.body as import("stream/web").ReadableStream,
    );
    const transform = new Transform({
      transform(chunk, _enc, cb) {
        downloaded += chunk.length;
        const now = Date.now();
        const dt = now - lastTick;
        if (dt >= 400) {
          const instant = ((downloaded - lastBytes) / dt) * 1000;
          speed = speed === 0 ? instant : speed * 0.35 + instant * 0.65;
          lastTick = now;
          lastBytes = downloaded;
        }

        const done = total > 0 && downloaded >= total;
        if (now - lastPatch >= 250 || done) {
          lastPatch = now;
          const job = self.jobs.get(jobId);
          if (job) {
            const pct =
              total > 0
                ? progressStart + Math.round((downloaded / total) * span)
                : progressStart;
            self.patch(jobId, {
              bytesDownloaded: downloaded,
              bytesTotal: total || job.bytesTotal,
              progress: Math.min(progressEnd, pct),
              speedBytesPerSec: Math.round(speed),
            });
          }
        }
        cb(null, chunk);
      },
    });

    try {
      await pipeline(nodeStream, transform, createWriteStream(tmp));
      await fs.rename(tmp, destPath);
    } finally {
      this.patch(jobId, { speedBytesPerSec: 0 });
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const downloadManager = new DownloadManager();
