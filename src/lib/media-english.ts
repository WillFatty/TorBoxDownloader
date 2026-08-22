import { execFile } from "child_process";
import { createRequire } from "module";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import {
  assertUnderLibrary,
  invalidateProbeCache,
  isEnglishLangCode,
  probeStreams,
} from "./media-probe";

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));

const FFMPEG_TIMEOUT_MS = 45 * 60 * 1000;

let ffmpegPath: string | null | undefined;

async function resolveFfmpegPath(): Promise<string | null> {
  if (ffmpegPath !== undefined) return ffmpegPath;

  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    ffmpegPath = "ffmpeg";
    return ffmpegPath;
  } catch {
    // Fall through to bundled binary.
  }

  try {
    const bundled = nodeRequire("ffmpeg-static") as string | null;
    if (!bundled) throw new Error("missing");
    await fs.access(bundled, fs.constants.X_OK);
    ffmpegPath = bundled;
    return ffmpegPath;
  } catch {
    ffmpegPath = null;
    return null;
  }
}

export async function isFfmpegAvailable(): Promise<boolean> {
  return Boolean(await resolveFfmpegPath());
}

export interface EnglishOnlyResult {
  file: string;
  skipped: boolean;
  reason?: string;
  keptAudio: string[];
  removedAudio: string[];
  keptSubtitles: string[];
}

function tempOutputPath(filePath: string): string {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return path.join(dir, `.${base}.tb-en${ext}`);
}

export async function remuxEnglishOnly(
  filePath: string,
): Promise<EnglishOnlyResult> {
  const resolved = path.resolve(filePath);
  await assertUnderLibrary(resolved);

  const bin = await resolveFfmpegPath();
  if (!bin) throw new Error("ffmpeg is not available");

  const streams = await probeStreams(resolved);
  const video = streams.filter((s) => s.codecType === "video");
  const audio = streams.filter((s) => s.codecType === "audio");
  const subs = streams.filter((s) => s.codecType === "subtitle");

  if (!video.length) {
    throw new Error(`No video stream in ${path.basename(resolved)}`);
  }

  const engAudio = audio.filter((s) => isEnglishLangCode(s.language));
  const otherAudio = audio.filter((s) => !isEnglishLangCode(s.language));
  const engSubs = subs.filter((s) => isEnglishLangCode(s.language));

  if (!engAudio.length) {
    throw new Error(
      `No English audio track found in ${path.basename(resolved)}`,
    );
  }

  if (!otherAudio.length && engSubs.length === subs.length) {
    return {
      file: resolved,
      skipped: true,
      reason: "Already English-only",
      keptAudio: engAudio.map((s) => s.language || "eng"),
      removedAudio: [],
      keptSubtitles: engSubs.map((s) => s.language || "eng"),
    };
  }

  const args: string[] = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    resolved,
  ];

  for (const stream of video) {
    args.push("-map", `0:${stream.index}`);
  }
  for (const stream of engAudio) {
    args.push("-map", `0:${stream.index}`);
  }
  for (const stream of engSubs) {
    args.push("-map", `0:${stream.index}`);
  }

  // Keep chapters / metadata; drop attachments (fonts) that often break remux.
  args.push("-map_chapters", "0", "-map_metadata", "0");
  args.push("-c", "copy");

  const tmp = tempOutputPath(resolved);
  args.push(tmp);

  try {
    await execFileAsync(bin, args, {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });

    const outStat = await fs.stat(tmp);
    if (!outStat.size) {
      throw new Error("Remux produced an empty file");
    }

    const backup = `${resolved}.tb-bak`;
    await fs.rename(resolved, backup);
    try {
      await fs.rename(tmp, resolved);
      await fs.unlink(backup);
    } catch (err) {
      // Best-effort restore if the final swap fails.
      try {
        if (await exists(backup)) await fs.rename(backup, resolved);
      } catch {
        // ignore
      }
      throw err;
    }
  } finally {
    try {
      if (await exists(tmp)) await fs.unlink(tmp);
    } catch {
      // ignore
    }
  }

  await invalidateProbeCache(resolved);

  return {
    file: resolved,
    skipped: false,
    keptAudio: engAudio.map((s) => s.language || "eng"),
    removedAudio: otherAudio.map((s) => s.language || "und"),
    keptSubtitles: engSubs.map((s) => s.language || "eng"),
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function remuxEnglishOnlyMany(
  filePaths: string[],
): Promise<EnglishOnlyResult[]> {
  const results: EnglishOnlyResult[] = [];
  for (const file of filePaths) {
    results.push(await remuxEnglishOnly(file));
  }
  return results;
}
