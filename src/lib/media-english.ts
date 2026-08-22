import { execFile, spawn } from "child_process";
import { createRequire } from "module";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import {
  assertUnderLibrary,
  invalidateProbeCache,
  isEnglishLangCode,
  probeDurationSeconds,
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

export interface EnglishSubsResult {
  file: string;
  skipped: boolean;
  reason?: string;
  keptSubtitles: string[];
  removedSubtitles: string[];
}

function tempOutputPath(filePath: string): string {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return path.join(dir, `.${base}.tb-en${ext}`);
}

async function runFfmpegWithProgress(
  bin: string,
  args: string[],
  durationSec: number,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdoutBuf = "";
    let stderrTail = "";
    let lastEmit = 0;
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("ffmpeg timed out"));
    }, FFMPEG_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      let newlineAt = stdoutBuf.indexOf("\n");
      while (newlineAt >= 0) {
        const line = stdoutBuf.slice(0, newlineAt).trim();
        stdoutBuf = stdoutBuf.slice(newlineAt + 1);
        newlineAt = stdoutBuf.indexOf("\n");

        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1);

        // ffmpeg emits microseconds for both keys despite the `_ms` suffix.
        if (
          !onProgress ||
          !durationSec ||
          (key !== "out_time_us" && key !== "out_time_ms")
        ) {
          continue;
        }
        const micros = Number(value);
        if (!Number.isFinite(micros)) continue;

        const percent = Math.min(
          99,
          Math.floor((micros / 1_000_000 / durationSec) * 100),
        );
        const now = Date.now();
        if (percent >= 0 && now - lastEmit > 250) {
          lastEmit = now;
          onProgress(percent);
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-4000);
    });

    child.on("error", (err) => finish(err));

    child.on("close", (code) => {
      if (code === 0) {
        onProgress?.(100);
        finish();
        return;
      }
      const lastLine = stderrTail
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop();
      finish(new Error(lastLine || `ffmpeg exited with code ${code}`));
    });
  });
}

async function runRemuxWithMaps(
  resolved: string,
  mapIndexes: number[],
  onProgress?: (percent: number) => void,
): Promise<void> {
  const bin = await resolveFfmpegPath();
  if (!bin) throw new Error("ffmpeg is not available");

  const args: string[] = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-progress",
    "pipe:1",
    "-i",
    resolved,
  ];

  for (const index of mapIndexes) {
    args.push("-map", `0:${index}`);
  }

  // Keep chapters / metadata; drop attachments (fonts) that often break remux.
  args.push("-map_chapters", "0", "-map_metadata", "0");
  args.push("-c", "copy");

  const tmp = tempOutputPath(resolved);
  args.push(tmp);

  try {
    const durationSec = onProgress
      ? (await probeDurationSeconds(resolved)) ?? 0
      : 0;
    await runFfmpegWithProgress(bin, args, durationSec, onProgress);

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
}

export async function remuxEnglishOnly(
  filePath: string,
  onProgress?: (percent: number) => void,
): Promise<EnglishOnlyResult> {
  const resolved = path.resolve(filePath);
  await assertUnderLibrary(resolved);

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

  const mapIndexes = [
    ...video.map((s) => s.index),
    ...engAudio.map((s) => s.index),
    ...engSubs.map((s) => s.index),
  ];

  await runRemuxWithMaps(resolved, mapIndexes, onProgress);

  return {
    file: resolved,
    skipped: false,
    keptAudio: engAudio.map((s) => s.language || "eng"),
    removedAudio: otherAudio.map((s) => s.language || "und"),
    keptSubtitles: engSubs.map((s) => s.language || "eng"),
  };
}

export async function remuxEnglishSubsOnly(
  filePath: string,
  onProgress?: (percent: number) => void,
): Promise<EnglishSubsResult> {
  const resolved = path.resolve(filePath);
  await assertUnderLibrary(resolved);

  const streams = await probeStreams(resolved);
  const video = streams.filter((s) => s.codecType === "video");
  const audio = streams.filter((s) => s.codecType === "audio");
  const subs = streams.filter((s) => s.codecType === "subtitle");
  const engSubs = subs.filter((s) => isEnglishLangCode(s.language));
  const otherSubs = subs.filter((s) => !isEnglishLangCode(s.language));

  if (!video.length) {
    throw new Error(`No video stream in ${path.basename(resolved)}`);
  }

  if (!subs.length || !otherSubs.length) {
    return {
      file: resolved,
      skipped: true,
      reason: subs.length
        ? "Subtitles are already English-only"
        : "No subtitles to clean",
      keptSubtitles: engSubs.map((s) => s.language || "eng"),
      removedSubtitles: [],
    };
  }

  const mapIndexes = [
    ...video.map((s) => s.index),
    ...audio.map((s) => s.index),
    ...engSubs.map((s) => s.index),
  ];

  await runRemuxWithMaps(resolved, mapIndexes, onProgress);

  return {
    file: resolved,
    skipped: false,
    keptSubtitles: engSubs.map((s) => s.language || "eng"),
    removedSubtitles: otherSubs.map((s) => s.language || "und"),
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
