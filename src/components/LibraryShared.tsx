"use client";

import type { CSSProperties } from "react";

export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? "Server returned an empty response"
        : `Request failed (${res.status})`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      res.ok
        ? `Server returned an invalid response (${res.status})`
        : `Request failed (${res.status})`,
    );
  }
}

export interface LibMovie {
  name: string;
  year: string | null;
  fileCount: number;
  files: string[];
  folder: string;
}

export interface LibShow {
  name: string;
  seasons: number[];
  episodeCount: number;
  folder: string;
  episodes: Array<{
    season: number;
    episode: number;
    fileName: string;
    path?: string;
  }>;
}

export interface MediaLanguages {
  audio: Array<{ code: string; label: string }>;
  subtitles: Array<{ code: string; label: string }>;
}

export interface NamingIssue {
  scope: "folder" | "file";
  severity: "error" | "warn";
  code: string;
  message: string;
  expected?: string;
  actual?: string;
  file?: string;
}

export interface ArtworkEntry {
  poster: string | null;
  imdbId: string | null;
  canonicalName?: string | null;
  canonicalYear?: string | null;
  namingIssues?: NamingIssue[];
}

export type LibSelection =
  | { kind: "movie"; movie: LibMovie }
  | { kind: "show"; show: LibShow };

export function tileInitials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function tileHue(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 3600;
  }
  return hash % 360;
}

export function hueStyle(name: string): CSSProperties {
  return { "--tile-hue": tileHue(name) } as CSSProperties;
}

export function ArtThumb({
  name,
  poster,
  onError,
}: {
  name: string;
  poster: string | null;
  onError: () => void;
}) {
  return (
    <span className="lib-art">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          loading="lazy"
          className="lib-art-img"
          onError={onError}
        />
      ) : (
        <span className="lib-tile" style={hueStyle(name)}>
          {tileInitials(name)}
        </span>
      )}
    </span>
  );
}
