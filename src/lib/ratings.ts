import path from "path";
import { STORE_KEYS, storeGetJSON, storeSetJSON } from "./store";
import type { MediaRatings, MediaType } from "./types";

const CINEMETA = "https://v3-cinemeta.strem.io";
const OMDB = "https://www.omdbapi.com";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = process.env.RATINGS_CACHE_PATH
  ? path.resolve(process.env.RATINGS_CACHE_PATH)
  : path.join(DATA_DIR, "ratings-cache.json");

/** Scores are considered fresh for 48 hours, then refetched live. */
const TTL_MS = 48 * 60 * 60 * 1000;

/** Bump when sourcing/mapping rules change so stale entries are refetched. */
const CACHE_VERSION = "v1";

interface CinemetaMeta {
  imdbRating?: string;
  awards?: string;
}

interface OmdbRatingsEntry {
  Source?: string;
  Value?: string;
}

interface OmdbResponse {
  Response?: string;
  Error?: string;
  imdbRating?: string;
  imdbVotes?: string;
  Ratings?: OmdbRatingsEntry[];
}

interface CacheEntry {
  ratings: MediaRatings | null;
  at: number;
  hasOmdb: boolean;
}

let cache: Record<string, CacheEntry> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function loadCache(): Promise<Record<string, CacheEntry>> {
  if (cache) return cache;
  try {
    const parsed = await storeGetJSON<Record<string, CacheEntry>>(
      STORE_KEYS.ratingsCache,
      CACHE_FILE,
    );
    cache = {};
    for (const [key, entry] of Object.entries(parsed || {})) {
      if (key.startsWith(`${CACHE_VERSION}:`)) cache[key] = entry;
    }
  } catch {
    cache = {};
  }
  return cache;
}

function persistCache(): Promise<void> {
  writeChain = writeChain.then(async () => {
    if (!cache) return;
    try {
      await storeSetJSON(STORE_KEYS.ratingsCache, cache, CACHE_FILE);
    } catch {
      // An unwritable cache only costs repeat lookups, never correctness.
    }
  });
  return writeChain;
}

function cacheKey(
  type: MediaType,
  imdbId: string,
  hasOmdb: boolean,
): string {
  return `${CACHE_VERSION}:${type}:${imdbId}:${hasOmdb ? "omdb" : "no-omdb"}`;
}

/**
 * Return aggregate review scores for a title, cached for 48 hours.
 *
 * Sourcing:
 * 1. Cinemeta (free, no key) always supplies the IMDb rating + award summary.
 * 2. If an OMDb API key is configured, add Rotten Tomatoes + Metacritic.
 *
 * Entries are cached keyed by (type, imdbId, hasOmdb) with a timestamp; within
 * 48 hours the stored result is returned as-is, otherwise it is refetched live
 * and the cache refreshed.
 */
export async function getMediaRatings(
  type: MediaType,
  imdbId: string,
  omdbApiKey: string,
): Promise<MediaRatings | null> {
  const hasOmdb = Boolean(omdbApiKey);
  const key = cacheKey(type, imdbId, hasOmdb);
  const now = Date.now();

  const cached = await getCached(key);
  if (cached && now - cached.at < TTL_MS) return cached.ratings;

  const ratings = await fetchRatings(type, imdbId, omdbApiKey);
  await setCached(key, { ratings, at: now, hasOmdb });
  return ratings;
}

async function getCached(key: string): Promise<CacheEntry | null> {
  const map = await loadCache();
  return map[key] || null;
}

async function setCached(key: string, entry: CacheEntry): Promise<void> {
  const map = await loadCache();
  map[key] = entry;
  await persistCache();
}

async function fetchRatings(
  type: MediaType,
  imdbId: string,
  omdbApiKey: string,
): Promise<MediaRatings | null> {
  const scores: MediaRatings["scores"] = [];
  const sources: string[] = [];

  // IMDb + awards from Cinemeta (no key required).
  const cinemeta = await fetchCinemeta(type, imdbId);
  if (cinemeta) {
    if (cinemeta.imdbRating) {
      sources.push("imdb");
      scores.push({
        source: "IMDb",
        value: cinemeta.imdbRating,
        url: `https://www.imdb.com/title/${imdbId}`,
      });
    }
  }

  // Rotten Tomatoes + Metacritic + authoritative IMDb from OMDb (optional key).
  if (omdbApiKey) {
    const omdb = await fetchOmdb(imdbId, omdbApiKey);
    if (omdb) {
      for (const entry of omdb.Ratings || []) {
        const source = normalizeSource(entry.Source);
        if (!source || !entry.Value) continue;
        if (sources.includes(source.key)) continue;
        sources.push(source.key);
        scores.push({ source: source.label, value: entry.Value });
      }
    }
  }

  if (!scores.length && !cinemeta?.awards) return null;

  return {
    sources,
    scores,
    summary: cinemeta?.awards || undefined,
  };
}

async function fetchCinemeta(
  type: MediaType,
  imdbId: string,
): Promise<CinemetaMeta | null> {
  try {
    const res = await fetch(`${CINEMETA}/meta/${type}/${imdbId}.json`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { meta?: CinemetaMeta };
    return data.meta || null;
  } catch {
    return null;
  }
}

async function fetchOmdb(
  imdbId: string,
  apiKey: string,
): Promise<OmdbResponse | null> {
  try {
    const url = `${OMDB}/?apikey=${encodeURIComponent(
      apiKey,
    )}&i=${encodeURIComponent(imdbId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as OmdbResponse;
    if (data.Response === "False" || data.Error) return null;
    return data;
  } catch {
    return null;
  }
}

function normalizeSource(
  source?: string,
): { key: string; label: string } | null {
  if (!source) return null;
  if (/rotten tomat/i.test(source)) {
    return { key: "rotten_tomatoes", label: "Rotten Tomatoes" };
  }
  if (/metacritic/i.test(source)) {
    return { key: "metacritic", label: "Metacritic" };
  }
  if (/internet movie database|imdb/i.test(source)) {
    return { key: "imdb", label: "IMDb" };
  }
  return { key: source, label: source };
}
