import path from "path";
import type { MediaType } from "./types";

const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeFileName(name: string): string {
  return name
    .replace(INVALID, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface JellyfinNamingInput {
  mediaName: string;
  year: string;
  mediaType: MediaType;
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string | null;
  quality: string;
  extension: string;
  /** Basename only — used when useAutoName is false */
  customFileName?: string | null;
  useAutoName?: boolean;
}

/**
 * Paths relative to the Movies or TV-Shows library root:
 *   Movies root → {Title} ({Year})/{Title} ({Year}) - {Quality}.mkv
 *   TV root     → {Show}/Season {N}/{Show} - SxxExx - {Episode Title}.mkv
 */
export function buildJellyfinPaths(opts: JellyfinNamingInput): {
  relativeDir: string;
  fileName: string;
  relativePath: string;
} {
  const title = sanitizeFileName(opts.mediaName);
  const quality = sanitizeFileName(opts.quality || "Unknown");
  const ext = (opts.extension || "mkv").replace(/^\./, "").toLowerCase();
  const useAuto = opts.useAutoName !== false;

  if (opts.mediaType === "series") {
    const season = opts.season ?? 1;
    const episode = opts.episode ?? 1;
    const seasonFolder = `Season ${season}`;
    const relativeDir = path.join(title, seasonFolder);

    let fileName: string;
    if (!useAuto && opts.customFileName?.trim()) {
      fileName = ensureExtension(opts.customFileName, ext);
    } else {
      const epCode = `S${pad2(season)}E${pad2(episode)}`;
      const epTitle = sanitizeFileName(opts.episodeTitle || "");
      // Prefer episode title; never use resolution as a fake title
      const base = epTitle
        ? `${title} - ${epCode} - ${epTitle}`
        : `${title} - ${epCode}`;
      fileName = `${sanitizeFileName(base)}.${ext}`;
    }

    return {
      relativeDir,
      fileName,
      relativePath: path.join(relativeDir, fileName),
    };
  }

  const year = opts.year ? ` (${opts.year})` : "";
  const movieFolder = sanitizeFileName(`${title}${year}`);
  const relativeDir = movieFolder;

  let fileName: string;
  if (!useAuto && opts.customFileName?.trim()) {
    fileName = ensureExtension(opts.customFileName, ext);
  } else {
    fileName = `${sanitizeFileName(`${movieFolder} - ${quality}`)}.${ext}`;
  }

  return {
    relativeDir,
    fileName,
    relativePath: path.join(relativeDir, fileName),
  };
}

export function buildAutoFileName(opts: {
  mediaName: string;
  year: string;
  mediaType: MediaType;
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string | null;
  quality: string;
  extension: string;
}): string {
  return buildJellyfinPaths({ ...opts, useAutoName: true }).fileName;
}

export function ensureExtension(fileName: string, extension: string): string {
  const trimmed = fileName.trim();
  const match = trimmed.match(/^(.*?)(\.[a-z0-9]{2,4})?$/i);
  const base = sanitizeFileName(match?.[1] || trimmed);
  const fromName = match?.[2]?.replace(/^\./, "").toLowerCase();
  const ext = (fromName || extension.replace(/^\./, "") || "mkv").toLowerCase();
  return `${base}.${ext}`;
}
