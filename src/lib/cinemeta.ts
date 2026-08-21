import type { EpisodeVideo, MediaMeta, MediaType, SearchResult } from "./types";

const CINEMETA = "https://v3-cinemeta.strem.io";

interface CinemetaMeta {
  id?: string;
  imdb_id?: string;
  type?: string;
  name?: string;
  releaseInfo?: string;
  year?: string;
  poster?: string;
  background?: string;
  description?: string;
  genres?: string[];
  runtime?: string;
  videos?: Array<{
    id?: string;
    season?: number;
    episode?: number;
    title?: string;
    name?: string;
    released?: string;
  }>;
}

function yearFrom(meta: CinemetaMeta): string {
  const raw = meta.releaseInfo || meta.year || "";
  const match = String(raw).match(/\d{4}/);
  return match?.[0] ?? "";
}

function mapSearch(meta: CinemetaMeta, type: MediaType): SearchResult | null {
  const imdbId = meta.imdb_id || meta.id;
  if (!imdbId?.startsWith("tt") || !meta.name) return null;
  return {
    id: imdbId,
    imdbId,
    type,
    name: meta.name,
    year: yearFrom(meta),
    poster: meta.poster || null,
    description: meta.description,
  };
}

function mapMeta(meta: CinemetaMeta, type: MediaType): MediaMeta | null {
  const imdbId = meta.imdb_id || meta.id;
  if (!imdbId?.startsWith("tt") || !meta.name) return null;

  const videos: EpisodeVideo[] | undefined =
    type === "series" && Array.isArray(meta.videos)
      ? meta.videos
          .filter((v) => typeof v.season === "number" && typeof v.episode === "number")
          .map((v) => ({
            id: v.id || `${imdbId}:${v.season}:${v.episode}`,
            season: v.season as number,
            episode: v.episode as number,
            title: v.title || v.name || `Episode ${v.episode}`,
            released: v.released,
          }))
          .sort((a, b) => a.season - b.season || a.episode - b.episode)
      : undefined;

  return {
    id: imdbId,
    imdbId,
    type,
    name: meta.name,
    year: yearFrom(meta),
    poster: meta.poster || null,
    background: meta.background || null,
    description: meta.description || "",
    genres: meta.genres || [],
    runtime: meta.runtime,
    videos,
  };
}

export async function searchMedia(
  query: string,
  type?: MediaType,
): Promise<SearchResult[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];

  const urls: Array<{ url: string; type: MediaType }> = [];
  if (!type || type === "movie") {
    urls.push({
      url: `${CINEMETA}/catalog/movie/top/search=${q}.json`,
      type: "movie",
    });
  }
  if (!type || type === "series") {
    urls.push({
      url: `${CINEMETA}/catalog/series/top/search=${q}.json`,
      type: "series",
    });
  }

  const responses = await Promise.all(
    urls.map(async ({ url, type: t }) => {
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) return [] as SearchResult[];
      const data = (await res.json()) as { metas?: CinemetaMeta[] };
      return (data.metas || [])
        .map((m) => mapSearch(m, t))
        .filter((m): m is SearchResult => Boolean(m));
    }),
  );

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const item of responses.flat()) {
    const key = `${item.type}:${item.imdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

export async function getMediaMeta(
  type: MediaType,
  imdbId: string,
): Promise<MediaMeta | null> {
  const res = await fetch(`${CINEMETA}/meta/${type}/${imdbId}.json`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { meta?: CinemetaMeta };
  if (!data.meta) return null;
  return mapMeta(data.meta, type);
}

export async function getEpisodeTitleMap(
  imdbId: string,
): Promise<Record<string, string>> {
  const res = await fetch(`${CINEMETA}/meta/series/${imdbId}.json`, {
    cache: "no-store",
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { meta?: CinemetaMeta };
  const out: Record<string, string> = {};
  for (const v of data.meta?.videos || []) {
    if (typeof v.season !== "number" || typeof v.episode !== "number") continue;
    const title = (v.title || v.name || "").trim();
    if (!title) continue;
    out[`${v.season}:${v.episode}`] = title;
  }
  return out;
}
