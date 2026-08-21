import type { TorBoxFile } from "./torbox";

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|ts|mov)$/i;

export interface ParsedEpisode {
  season: number;
  episode: number;
  /** basename without path */
  fileName: string;
  ext: string;
}

export interface EpisodeFile extends ParsedEpisode {
  file: TorBoxFile;
}

const EP_PATTERNS = [
  /[Ss](\d{1,2})[Ee](\d{1,3})/,
  /(\d{1,2})x(\d{1,3})/i,
  /Season[ ._-]*(\d{1,2})[ ._-]*Episode[ ._-]*(\d{1,3})/i,
];

export function parseEpisodeFromName(name: string): ParsedEpisode | null {
  const base = name.split(/[/\\]/).pop() || name;
  for (const re of EP_PATTERNS) {
    const m = base.match(re);
    if (!m) continue;
    const season = parseInt(m[1], 10);
    const episode = parseInt(m[2], 10);
    if (!Number.isFinite(season) || !Number.isFinite(episode)) continue;
    const extMatch = base.match(VIDEO_EXT);
    return {
      season,
      episode,
      fileName: base,
      ext: (extMatch?.[1] || "mkv").toLowerCase(),
    };
  }
  return null;
}

/** Detect pack / multi-ep hints in Comet stream title before download. */
export function detectPackHint(...parts: Array<string | null | undefined>): {
  isPack: boolean;
  label: string | null;
} {
  const blob = parts.filter(Boolean).join("\n");
  if (!blob) return { isPack: false, label: null };

  if (/\bseason\s*pack\b|\bcomplete\s*season\b|\bfull\s*season\b|\bseason\s*\d+\s*complete\b/i.test(blob)) {
    return { isPack: true, label: "Season pack" };
  }
  if (/\bS\d{1,2}E\d{1,3}\s*[-–]\s*E?\d{1,3}\b/i.test(blob)) {
    return { isPack: true, label: "Multi-episode" };
  }
  if (/\bS\d{1,2}E\d{1,3}\s*[-–]\s*S\d{1,2}E\d{1,3}\b/i.test(blob)) {
    return { isPack: true, label: "Multi-episode" };
  }
  if (/\b\d{1,2}\s*episodes?\b/i.test(blob)) {
    return { isPack: true, label: "Multi-episode" };
  }
  if (/\bpack\b/i.test(blob) && !/\bsample\b/i.test(blob)) {
    return { isPack: true, label: "Pack" };
  }
  return { isPack: false, label: null };
}

export function listEpisodeVideos(files: TorBoxFile[] | undefined): EpisodeFile[] {
  if (!files?.length) return [];
  const out: EpisodeFile[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!VIDEO_EXT.test(file.name)) continue;
    // skip tiny samples
    if (file.size > 0 && file.size < 50 * 1024 * 1024 && /sample/i.test(file.name)) {
      continue;
    }
    const parsed = parseEpisodeFromName(file.name);
    if (!parsed) continue;
    const key = `${parsed.season}:${parsed.episode}`;
    const existing = out.find((e) => `${e.season}:${e.episode}` === key);
    if (existing) {
      // keep larger file for same episode
      if (file.size > existing.file.size) {
        existing.file = file;
        existing.fileName = parsed.fileName;
        existing.ext = parsed.ext;
      }
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...parsed, file });
  }

  return out.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

export function describeEpisodeBatch(episodes: EpisodeFile[]): string {
  if (!episodes.length) return "";
  if (episodes.length === 1) {
    return `S${String(episodes[0].season).padStart(2, "0")}E${String(episodes[0].episode).padStart(2, "0")}`;
  }
  const seasons = [...new Set(episodes.map((e) => e.season))];
  if (seasons.length === 1) {
    const eps = episodes.map((e) => e.episode);
    const min = Math.min(...eps);
    const max = Math.max(...eps);
    return `S${String(seasons[0]).padStart(2, "0")}E${String(min).padStart(2, "0")}-E${String(max).padStart(2, "0")} (${episodes.length} files)`;
  }
  return `${episodes.length} episodes across ${seasons.length} seasons`;
}
