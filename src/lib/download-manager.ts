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
import { STORE_KEYS, storeGetJSON, storeSetJSON } from "./store";
import {
  createTorrent,
  getTorrentById,
  isTorrentReady,
  isTransientTorBoxError,
  normalizeTorrentProgress,
  pickBestVideoFile,
  requestDownloadLink,
  TorBoxError,
  type TorBoxFile,
  type TorBoxTorrent,
} from "./torbox";
import type { CreateDownloadInput, DownloadJob, DownloadStatus } from "./types";

const JOBS_FILE = process.env.JOBS_PATH
  ? path.resolve(process.env.JOBS_PATH)
  : path.join(process.cwd(), "data", "jobs.json");

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
  /** AbortControllers for in-flight file saves, keyed by job id */
  private controllers = new Map<string, AbortController>();

  private static ACTIVE: ReadonlySet<DownloadStatus> = new Set([
    "queued",
    "creating",
    "torbox_downloading",
    "fetching_link",
    "saving",
  ]);

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
      const list = await storeGetJSON<DownloadJob[]>(
        STORE_KEYS.jobs,
        JOBS_FILE,
      );
      for (const job of list || []) {
        if (!job.savedFiles) job.savedFiles = [];
        if (job.multiEpisode == null) job.multiEpisode = false;
        if (job.packSummary === undefined) job.packSummary = null;
        if (job.episodeTitle === undefined) job.episodeTitle = null;
        if (job.imdbId === undefined) job.imdbId = null;
        if (job.speedBytesPerSec == null) job.speedBytesPerSec = 0;
        if (job.fileIdx === undefined) job.fileIdx = null;
        if (job.useAutoName === undefined) job.useAutoName = true;
        if (job.customFileName === undefined) job.customFileName = null;
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
    const list = [...this.jobs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    try {
      await storeSetJSON(STORE_KEYS.jobs, list, JOBS_FILE);
    } catch (err) {
      console.error(
        "[jobs] failed to persist:",
        err instanceof Error ? err.message : err,
      );
    }
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
      fileIdx: input.fileIdx,
      useAutoName: input.useAutoName,
      customFileName: input.useAutoName ? null : input.customFileName || null,
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

  cancel(id: string): "ok" | "missing" | "inactive" {
    const job = this.jobs.get(id);
    if (!job) return "missing";
    if (!DownloadManager.ACTIVE.has(job.status)) return "inactive";
    this.patch(id, { status: "cancelled", speedBytesPerSec: 0 });
    this.controllers.get(id)?.abort();
    return "ok";
  }

  async remove(id: string): Promise<boolean> {
    await this.load();
    const job = this.jobs.get(id);
    if (!job) return false;
    if (DownloadManager.ACTIVE.has(job.status)) {
      this.cancel(id);
      // Give the in-flight save a beat to unwind before dropping the record.
      for (let i = 0; i < 20 && this.running.has(id); i++) {
        await sleep(100);
      }
    }
    this.jobs.delete(id);
    this.titleMaps.delete(id);
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    await this.persist();
    return true;
  }

  async retry(id: string): Promise<DownloadJob | null> {
    await this.load();
    const old = this.jobs.get(id);
    if (!old) return null;
    return this.enqueue({
      infoHash: old.infoHash,
      fileIdx: old.fileIdx ?? null,
      mediaName: old.mediaName,
      mediaType: old.mediaType,
      imdbId: old.imdbId,
      year: old.year,
      season: old.season,
      episode: old.episode,
      episodeTitle: old.episodeTitle,
      quality: old.quality,
      useAutoName: old.useAutoName ?? true,
      customFileName: (old.useAutoName ?? true) ? null : old.customFileName,
    });
  }

  private isCancelled(id: string): boolean {
    return this.jobs.get(id)?.status === "cancelled";
  }

  /** True when destPath already holds a complete file of expectedSize bytes. */
  private async alreadySaved(
    destPath: string,
    expectedSize: number,
  ): Promise<boolean> {
    if (!expectedSize) return false;
    try {
      const st = await fs.stat(destPath);
      return st.isFile() && st.size === expectedSize;
    } catch {
      return false;
    }
  }

  private async run(jobId: string, fileIdx: number | null) {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);

    const controller = new AbortController();
    this.controllers.set(jobId, controller);

    try {
      const settings = await getSettings();
      const job = this.jobs.get(jobId);
      if (!job || job.status === "cancelled") return;

      this.patch(jobId, { status: "creating", progress: 5 });
      const magnet = hashToMagnet(job.infoHash);
      const created = await createTorrent(
        settings.torboxApiKey,
        magnet,
        job.mediaName,
      );
      if (this.isCancelled(jobId)) return;
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
      if (!torrent || this.isCancelled(jobId)) return;

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

      if (this.isCancelled(jobId)) return;
      if (await this.alreadySaved(destPath, file.size)) {
        this.patch(jobId, {
          status: "completed",
          progress: 100,
          bytesDownloaded: file.size,
          savedFiles: [destPath],
        });
        return;
      }

      let lastSaveError: unknown = null;
      let savedOk = false;
      for (let attempt = 1; attempt <= 3 && !savedOk; attempt++) {
        try {
          const link = await requestDownloadLink(
            settings.torboxApiKey,
            created.torrent_id,
            file.id,
          );
          if (this.isCancelled(jobId)) return;

          this.patch(jobId, { status: "saving", progress: 75 });
          await this.saveFile(jobId, link, destPath, file.size, 75, 99);
          savedOk = true;
        } catch (err) {
          if (this.isCancelled(jobId)) return;
          lastSaveError = err;
          if (attempt < 3) await sleep(1500 * attempt);
        }
      }
      if (!savedOk) throw lastSaveError;

      this.patch(jobId, {
        status: "completed",
        progress: 100,
        bytesDownloaded: file.size,
        savedFiles: [destPath],
      });
    } catch (err) {
      if (this.isCancelled(jobId)) return;
      const message =
        err instanceof TorBoxError && err.status === 429
          ? "TorBox rate limit reached — automatic retries didn't help. Try again in a minute."
          : err instanceof Error
            ? err.message
            : "Download failed";
      this.patch(jobId, { status: "failed", error: message });
    } finally {
      this.running.delete(jobId);
      this.controllers.delete(jobId);
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
    const failures: { label: string; message: string }[] = [];
    let cumulativeBytes = 0;

    for (let i = 0; i < episodes.length; i++) {
      if (this.isCancelled(jobId)) return;
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
      const startPct = 70 + Math.round((i / episodes.length) * 28);
      const endPct = 70 + Math.round(((i + 1) / episodes.length) * 28);

      // Resume support: skip episodes already complete on disk
      if (await this.alreadySaved(dest, ep.file.size)) {
        saved.push(dest);
        cumulativeBytes += ep.file.size || 0;
        this.patch(jobId, {
          torboxFileId: ep.file.id,
          fileName: jelly.fileName,
          downloadPath: dest,
          season: ep.season,
          episode: ep.episode,
          savedFiles: [...saved],
          bytesDownloaded: cumulativeBytes,
          progress: endPct,
          packSummary: `${summary} · saved ${saved.length}/${episodes.length}`,
        });
        continue;
      }

      let lastError: unknown = null;
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        if (this.isCancelled(jobId)) return;
        try {
          this.patch(jobId, {
            status: "fetching_link",
            torboxFileId: ep.file.id,
            fileName: jelly.fileName,
            downloadPath: dest,
            season: ep.season,
            episode: ep.episode,
          });

          const link = await requestDownloadLink(apiKey, torrentId, ep.file.id);
          if (this.isCancelled(jobId)) return;

          this.patch(jobId, { status: "saving", progress: startPct });
          await this.saveFile(
            jobId,
            link,
            dest,
            ep.file.size,
            startPct,
            endPct,
            { offset: cumulativeBytes, total: totalBytes },
          );
          ok = true;
        } catch (err) {
          if (this.isCancelled(jobId)) return;
          lastError = err;
          if (attempt < 3) await sleep(1500 * attempt);
        }
      }

      if (!ok) {
        failures.push({
          label: `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`,
          message:
            lastError instanceof Error
              ? lastError.message
              : String(lastError ?? "Unknown error"),
        });
        this.patch(jobId, {
          progress: endPct,
          packSummary: `${summary} · saved ${saved.length}/${episodes.length}`,
        });
        continue;
      }

      saved.push(dest);
      cumulativeBytes += ep.file.size || 0;
      this.patch(jobId, {
        savedFiles: [...saved],
        bytesDownloaded: cumulativeBytes,
        progress: endPct,
        packSummary: `${summary} · saved ${saved.length}/${episodes.length}`,
      });

      // Brief pause between pack files so requestdl isn't hammered
      if (i < episodes.length - 1) await sleep(750);
    }

    if (failures.length > 0) {
      const list = failures
        .slice(0, 6)
        .map((f) => f.label)
        .join(", ");
      const more = failures.length > 6 ? ` +${failures.length - 6} more` : "";
      this.patch(jobId, {
        status: "failed",
        speedBytesPerSec: 0,
        savedFiles: saved,
        bytesTotal: totalBytes,
        bytesDownloaded: cumulativeBytes,
        error: `Saved ${saved.length}/${episodes.length} episodes — ${failures.length} failed (${list}${more}). Retry will skip already-saved episodes.`,
      });
      return;
    }

    this.patch(jobId, {
      status: "completed",
      progress: 100,
      savedFiles: saved,
      bytesDownloaded: cumulativeBytes,
      bytesTotal: totalBytes,
      packSummary: `Saved ${saved.length} episodes (${summary})`,
      fileName: `${job.mediaName} — ${saved.length} episodes`,
      downloadPath: path.join(tvShowsRoot, job.mediaName),
      error: null,
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
        if (this.isCancelled(jobId)) return null;

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
          const rateLimited = err instanceof TorBoxError && err.status === 429;
          await sleep(rateLimited ? 10_000 : Math.min(8_000, pollMs * 2));
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
    bytes?: { offset: number; total: number },
  ) {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const tmp = `${destPath}.part`;
    const signal = this.controllers.get(jobId)?.signal;

    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) {
      let detail = "";
      try {
        const text = await res.text();
        detail = text.replace(/\s+/g, " ").trim().slice(0, 300);
      } catch {}
      throw new Error(
        `File download failed (${res.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    const total = Number(res.headers.get("content-length")) || expectedSize || 0;
    let downloaded = 0;
    const span = Math.max(1, progressEnd - progressStart);
    let lastTick = Date.now();
    let lastBytes = 0;
    let speed = 0;
    let lastPatch = 0;

    const nodeStream = Readable.fromWeb(
      res.body as import("stream/web").ReadableStream,
    );
    const transform = new Transform({
      transform: (chunk, _enc, cb) => {
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
          const job = this.jobs.get(jobId);
          if (job) {
            if (job.status === "cancelled") {
              this.controllers.get(jobId)?.abort();
              cb(new Error("Cancelled"));
              return;
            }
            const pct =
              total > 0
                ? progressStart + Math.round((downloaded / total) * span)
                : progressStart;
            this.patch(jobId, {
              bytesDownloaded: (bytes?.offset ?? 0) + downloaded,
              bytesTotal: bytes ? bytes.total : total || job.bytesTotal,
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
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    } finally {
      this.patch(jobId, { speedBytesPerSec: 0 });
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const downloadManager = new DownloadManager();
