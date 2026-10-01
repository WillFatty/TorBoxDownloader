import { execFile } from "child_process";
import { createRequire } from "module";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { getSettings, libraryRootFor } from "./settings";
import { STORE_KEYS, storeGetJSON, storeSetJSON } from "./store";
import { isRemuxActive } from "./remux-progress";

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = process.env.MEDIA_PROBE_CACHE_PATH
  ? path.resolve(process.env.MEDIA_PROBE_CACHE_PATH)
  : path.join(DATA_DIR, "media-probe-cache.json");

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FFPROBE_TIMEOUT_MS = 20_000;

export interface TrackLang {
  code: string;
  label: string;
}

export interface MediaLanguages {
  audio: TrackLang[];
  subtitles: TrackLang[];
}

interface CacheEntry extends MediaLanguages {
  size: number;
  mtimeMs: number;
  at: number;
}

let cache: Record<string, CacheEntry> | null = null;
let writeChain: Promise<void> = Promise.resolve();
let ffprobePath: string | null | undefined;

async function loadCache(): Promise<Record<string, CacheEntry>> {
  if (cache) return cache;
  try {
    cache =
      (await storeGetJSON<Record<string, CacheEntry>>(
        STORE_KEYS.probeCache,
        CACHE_FILE,
      )) || {};
  } catch {
    cache = {};
  }
  return cache!;
}

function persistCache(): Promise<void> {
  writeChain = writeChain.then(async () => {
    if (!cache) return;
    try {
      await storeSetJSON(STORE_KEYS.probeCache, cache, CACHE_FILE);
    } catch {
      // Cache is optional.
    }
  });
  return writeChain;
}

async function resolveFfprobePath(): Promise<string | null> {
  if (ffprobePath !== undefined) return ffprobePath;

  // Prefer a system install when present (Docker image).
  try {
    await execFileAsync("ffprobe", ["-version"], { timeout: 5000 });
    ffprobePath = "ffprobe";
    return ffprobePath;
  } catch {
    // Fall through to the bundled binary.
  }

  try {
    const installer = nodeRequire("@ffprobe-installer/ffprobe") as {
      path: string;
    };
    await fs.access(installer.path, fs.constants.X_OK);
    ffprobePath = installer.path;
    return ffprobePath;
  } catch {
    ffprobePath = null;
    return null;
  }
}

export async function isFfprobeAvailable(): Promise<boolean> {
  return Boolean(await resolveFfprobePath());
}

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

function normalizeLangCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toLowerCase().replace(/_/g, "-");
  if (!code || code === "und" || code === "unknown" || code === "null") {
    return null;
  }
  // Keep region when present (en-us → en), but prefer base ISO 639.
  const base = code.split("-")[0];
  if (!/^[a-z]{2,3}$/.test(base)) return null;
  return base;
}

function labelFor(code: string): string {
  try {
    return LANGUAGE_NAMES.of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function uniqueLangs(codes: string[]): TrackLang[] {
  const seen = new Set<string>();
  const out: TrackLang[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label: labelFor(code) });
  }
  return out;
}

interface FfprobeStream {
  codec_type?: string;
  tags?: {
    language?: string;
    LANGUAGE?: string;
  };
}

interface FfprobeJson {
  streams?: FfprobeStream[];
}

async function runFfprobe(filePath: string): Promise<MediaLanguages> {
  const bin = await resolveFfprobePath();
  if (!bin) throw new Error("ffprobe is not available");

  const { stdout } = await execFileAsync(
    bin,
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      filePath,
    ],
    { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout || "{}") as FfprobeJson;
  const audio: string[] = [];
  const subs: string[] = [];

  for (const stream of parsed.streams || []) {
    const code = normalizeLangCode(
      stream.tags?.language || stream.tags?.LANGUAGE,
    );
    if (!code) continue;
    if (stream.codec_type === "audio") audio.push(code);
    else if (stream.codec_type === "subtitle") subs.push(code);
  }

  return {
    audio: uniqueLangs(audio),
    subtitles: uniqueLangs(subs),
  };
}

export async function assertUnderLibrary(filePath: string): Promise<void> {
  const settings = await getSettings();
  const resolved = path.resolve(filePath);
  const roots = [
    path.resolve(libraryRootFor(settings, "movie")),
    path.resolve(libraryRootFor(settings, "series")),
  ];
  const ok = roots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep),
  );
  if (!ok) throw new Error("Path is outside the library");
}

export async function probeMediaLanguages(
  filePath: string,
): Promise<MediaLanguages | null> {
  if (!(await isFfprobeAvailable())) return null;

  const resolved = path.resolve(filePath);
  await assertUnderLibrary(resolved);

  const stat = await fs.stat(resolved);
  const store = await loadCache();
  const hit = store[resolved];
  if (
    hit &&
    hit.size === stat.size &&
    hit.mtimeMs === stat.mtimeMs &&
    Date.now() - hit.at < CACHE_TTL_MS
  ) {
    return { audio: hit.audio, subtitles: hit.subtitles };
  }

  // A file being remuxed is off-limits: skip ffprobe rather than fight the
  // ffmpeg processes for disk I/O. Cached languages stay usable; otherwise
  // report none — the modal shows the file as "Remuxing" anyway.
  if (isRemuxActive(resolved)) {
    if (hit) {
      return { audio: hit.audio, subtitles: hit.subtitles };
    }
    return { audio: [], subtitles: [] };
  }

  const langs = await runFfprobe(resolved);
  store[resolved] = {
    ...langs,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    at: Date.now(),
  };
  void persistCache();
  return langs;
}

export async function invalidateProbeCache(filePath: string): Promise<void> {
  const store = await loadCache();
  delete store[path.resolve(filePath)];
  void persistCache();
}

export interface ProbeStream {
  index: number;
  codecType: string;
  language: string | null;
}

export async function probeStreams(
  filePath: string,
): Promise<ProbeStream[]> {
  const bin = await resolveFfprobePath();
  if (!bin) throw new Error("ffprobe is not available");

  const { stdout } = await execFileAsync(
    bin,
    ["-v", "quiet", "-print_format", "json", "-show_streams", filePath],
    { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout || "{}") as {
    streams?: Array<{
      index?: number;
      codec_type?: string;
      tags?: { language?: string; LANGUAGE?: string };
    }>;
  };

  return (parsed.streams || []).map((stream, i) => ({
    index: typeof stream.index === "number" ? stream.index : i,
    codecType: stream.codec_type || "unknown",
    language: normalizeLangCode(
      stream.tags?.language || stream.tags?.LANGUAGE,
    ),
  }));
}

export function isEnglishLangCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const base = code.toLowerCase().split("-")[0];
  return base === "en" || base === "eng";
}

export async function probeDurationSeconds(
  filePath: string,
): Promise<number | null> {
  const bin = await resolveFfprobePath();
  if (!bin) return null;

  try {
    const { stdout } = await execFileAsync(
      bin,
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_entries",
        "format=duration",
        filePath,
      ],
      { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout || "{}") as {
      format?: { duration?: string | number };
    };
    const raw = parsed.format?.duration;
    const seconds = typeof raw === "string" ? parseFloat(raw) : raw ?? null;
    return seconds && Number.isFinite(seconds) && seconds > 0
      ? seconds
      : null;
  } catch {
    return null;
  }
}

export async function probeManyMediaLanguages(
  filePaths: string[],
): Promise<Record<string, MediaLanguages>> {
  const out: Record<string, MediaLanguages> = {};
  if (!(await isFfprobeAvailable())) return out;

  const unique = [...new Set(filePaths.map((p) => path.resolve(p)))];
  const concurrency = 3;
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const file = unique[cursor];
      cursor += 1;
      try {
        const langs = await probeMediaLanguages(file);
        if (langs) out[file] = langs;
      } catch {
        // Skip unreadable / missing files.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, unique.length) }, () =>
      worker(),
    ),
  );
  return out;
}
