import type { StreamResult } from "./types";
import { detectPackHint } from "./episodes";

interface CometStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
    videoSize?: number;
    notWebReady?: boolean;
  };
}

const QUALITY_RE =
  /\b(2160p|1080p|720p|480p|360p|4k|uhd|hdr|remux|bluray|web-?dl|webrip|hdtv)\b/i;

export function extractQuality(...parts: Array<string | null | undefined>): string {
  const blob = parts.filter(Boolean).join(" ");
  const match = blob.match(QUALITY_RE);
  if (!match) return "Unknown";
  const q = match[1].toLowerCase();
  if (q === "4k" || q === "uhd") return "2160p";
  if (q.includes("web")) return blob.match(/\b(2160p|1080p|720p|480p)\b/i)?.[1] || "WEB";
  return match[1];
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function parseSizeFromText(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(TiB|GiB|MiB|TB|GB|MB|KB)\b/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const mult: Record<string, number> = {
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  };
  return Math.round(n * (mult[unit] || 0)) || null;
}

function parseSeeds(text: string): number | null {
  const match = text.match(/👤\s*(\d+)|seeds?\s*[:=]?\s*(\d+)/i);
  if (!match) return null;
  return parseInt(match[1] || match[2], 10);
}

function guessExt(filename: string | null, title: string): string {
  const fromName = (filename || title).match(/\.(mkv|mp4|avi|m4v|ts|mov)\b/i);
  return fromName?.[1]?.toLowerCase() || "mkv";
}

export function hashToMagnet(infoHash: string): string {
  const hash = infoHash.trim().toLowerCase();
  return `magnet:?xt=urn:btih:${hash}`;
}

export async function fetchCometStreams(opts: {
  cometUrl: string;
  type: "movie" | "series";
  mediaId: string;
}): Promise<StreamResult[]> {
  const base = opts.cometUrl.replace(/\/$/, "");
  const url = `${base}/stream/${opts.type}/${opts.mediaId}.json`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Comet stream request failed (${res.status})`);
  }
  const data = (await res.json()) as { streams?: CometStream[] };
  const streams = data.streams || [];

  const mapped: StreamResult[] = [];
  for (const s of streams) {
    let infoHash = s.infoHash?.trim();
    if (!infoHash && s.url?.startsWith("magnet:")) {
      const m = s.url.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
      infoHash = m?.[1];
    }
    if (!infoHash) continue;

    const title = s.title || s.description || s.name || infoHash;
    const name = s.name || "Comet";
    const sizeBytes =
      s.behaviorHints?.videoSize ?? parseSizeFromText(`${title}\n${name}`);
    const filename = s.behaviorHints?.filename || null;

    mapped.push({
      infoHash: infoHash.toLowerCase(),
      title,
      name,
      quality: extractQuality(name, title, filename),
      size: formatBytes(sizeBytes) || null,
      sizeBytes,
      seeds: parseSeeds(`${title}\n${name}`),
      fileIdx: typeof s.fileIdx === "number" ? s.fileIdx : null,
      filename,
      cached: null,
      url: s.url && !s.url.startsWith("magnet:") ? s.url : null,
      packHint: detectPackHint(name, title, filename).label,
    });
  }

  // Prefer higher quality / larger first
  const qualityRank: Record<string, number> = {
    "2160p": 4,
    "1080p": 3,
    "720p": 2,
    "480p": 1,
  };
  mapped.sort((a, b) => {
    const qa = qualityRank[a.quality] ?? 0;
    const qb = qualityRank[b.quality] ?? 0;
    if (qb !== qa) return qb - qa;
    return (b.sizeBytes || 0) - (a.sizeBytes || 0);
  });

  return mapped.map((s) => ({
    ...s,
    // stash guessed extension on filename if missing via helper for naming
    filename: s.filename || `stream.${guessExt(s.filename, s.title)}`,
  }));
}

export function extensionFromStream(stream: {
  filename?: string | null;
  title?: string;
}): string {
  return guessExt(stream.filename || null, stream.title || "");
}
