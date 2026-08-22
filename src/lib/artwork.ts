import { promises as fs } from "fs";
import path from "path";
import { searchMedia } from "./cinemeta";
import { normalizeTitle } from "./library";
import type { MediaType, SearchResult } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = process.env.ARTWORK_CACHE_PATH
  ? path.resolve(process.env.ARTWORK_CACHE_PATH)
  : path.join(DATA_DIR, "artwork-cache.json");

/** Bump when the matching rules change so stale misses are re-resolved. */
const MATCH_VERSION = "v2";
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_CONCURRENCY = 4;

export interface ArtworkRequest {
  key: string;
  type: MediaType;
  name: string;
  year?: string | null;
}

export interface ArtworkResult {
  poster: string | null;
  imdbId: string | null;
}

interface CacheEntry extends ArtworkResult {
  at: number;
}

let cache: Record<string, CacheEntry> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function loadCache(): Promise<Record<string, CacheEntry>> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    cache = {};
    for (const [key, entry] of Object.entries(parsed || {})) {
      // Drop entries written by older matching rules.
      if (key.startsWith(`${MATCH_VERSION}:`)) cache[key] = entry;
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
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify(cache), "utf8");
    } catch {
      // An unwritable cache only costs repeat lookups, never correctness.
    }
  });
  return writeChain;
}

function cacheKey(type: MediaType, name: string, year?: string | null): string {
  return `${MATCH_VERSION}:${type}:${normalizeTitle(name)}:${year || ""}`;
}

function isFresh(entry: CacheEntry): boolean {
  const ttl = entry.poster ? HIT_TTL_MS : MISS_TTL_MS;
  return Date.now() - entry.at < ttl;
}

const TRAILING_YEAR = /[\s._-]+\(?(\d{4})\)?$/;
const REGION_SUFFIX = /[\s._-]+\(?(uk|us|usa|au|nz|ca)\)?$/i;

/** Ignores separators entirely, so "SpiderMan" can meet "Spider-Man". */
function compactTitle(s: string): string {
  return normalizeTitle(s).replace(/\s+/g, "");
}

/**
 * Folder names carry conventions Cinemeta titles don't: a bare trailing year
 * ("Thor Ragnarok 2017") or a region tag ("Top Gear UK"). Try the name as-is
 * first and only strip once it has failed, so a title that genuinely ends in a
 * number ("Blade Runner 2049") still wins on its own.
 */
function titleVariants(name: string): string[] {
  const variants: string[] = [];
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !variants.includes(trimmed)) variants.push(trimmed);
  };

  add(name);
  const withoutYear = name.trim().replace(TRAILING_YEAR, "");
  add(withoutYear);
  add(withoutYear.replace(REGION_SUFFIX, ""));
  return variants;
}

function impliedYear(name: string): string | null {
  return name.trim().match(TRAILING_YEAR)?.[1] ?? null;
}

function preferYear(
  matches: SearchResult[],
  year: string | null,
): SearchResult | null {
  if (!matches.length) return null;
  if (year) {
    const sameYear = matches.find((r) => r.year === year);
    if (sameYear) return sameYear;
  }
  return matches[0];
}

/**
 * Titles must match in full once normalised. Partial matches would put the
 * wrong poster on a card, which is worse than showing none.
 */
function pickMatch(
  results: SearchResult[],
  name: string,
  year?: string | null,
): SearchResult | null {
  const effectiveYear = year || impliedYear(name);

  for (const variant of titleVariants(name)) {
    const target = normalizeTitle(variant);
    const exact = preferYear(
      results.filter((r) => normalizeTitle(r.name) === target),
      effectiveYear,
    );
    if (exact) return exact;

    const compact = compactTitle(variant);
    const loose = preferYear(
      results.filter((r) => compactTitle(r.name) === compact),
      effectiveYear,
    );
    if (loose) return loose;
  }

  return null;
}

async function lookup(
  item: ArtworkRequest,
): Promise<{ result: ArtworkResult; cacheable: boolean }> {
  try {
    const results = await searchMedia(item.name, item.type);
    const match = pickMatch(results, item.name, item.year);
    return {
      result: match
        ? { poster: match.poster, imdbId: match.imdbId }
        : { poster: null, imdbId: null },
      cacheable: true,
    };
  } catch {
    // Don't burn a 24h negative cache entry on a transient network failure.
    return { result: { poster: null, imdbId: null }, cacheable: false };
  }
}

export async function resolveArtwork(
  items: ArtworkRequest[],
): Promise<Record<string, ArtworkResult>> {
  const store = await loadCache();
  const out: Record<string, ArtworkResult> = {};
  const pending: ArtworkRequest[] = [];

  for (const item of items) {
    const entry = store[cacheKey(item.type, item.name, item.year)];
    if (entry && isFresh(entry)) {
      out[item.key] = { poster: entry.poster, imdbId: entry.imdbId };
    } else {
      pending.push(item);
    }
  }

  let cursor = 0;
  let dirty = false;

  async function worker() {
    while (cursor < pending.length) {
      const item = pending[cursor];
      cursor += 1;
      const { result, cacheable } = await lookup(item);
      out[item.key] = result;
      if (cacheable) {
        store[cacheKey(item.type, item.name, item.year)] = {
          ...result,
          at: Date.now(),
        };
        dirty = true;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(LOOKUP_CONCURRENCY, pending.length) }, () =>
      worker(),
    ),
  );

  if (dirty) await persistCache();
  return out;
}
