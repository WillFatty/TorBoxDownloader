import type { AppSettings } from "./types";

const DEFAULT_TIMEOUT_MS = 25_000;
const PAGE_SIZE = 1000;

export class JellyfinError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "JellyfinError";
  }
}

export function isJellyfinConfigured(settings: AppSettings): boolean {
  return Boolean(settings.jellyfinUrl?.trim() && settings.jellyfinApiKey?.trim());
}

function authHeaders(apiKey: string): HeadersInit {
  return { "X-Emby-Token": apiKey };
}

async function jellyfinFetch<T>(
  settings: AppSettings,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const base = settings.jellyfinUrl.trim().replace(/\/$/, "");
  if (!base) throw new JellyfinError("Jellyfin URL is not set");
  if (!settings.jellyfinApiKey.trim()) {
    throw new JellyfinError("Jellyfin API key is not set");
  }

  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...authHeaders(settings.jellyfinApiKey), ...(init?.headers || {}) },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        // ignore body read failures
      }
      throw new JellyfinError(
        `Jellyfin request failed (${res.status})${detail ? `: ${detail}` : ""}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new JellyfinError(
        `Jellyfin request timed out after ${timeoutMs}ms`,
        504,
      );
    }
    if (err instanceof Error && /fetch failed|econn|enotfound/i.test(err.message)) {
      throw new JellyfinError(
        `Could not reach the Jellyfin server at ${settings.jellyfinUrl}`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface JellyfinItemDto {
  Id?: string;
  Name?: string;
  Type?: string;
  Path?: string;
}

export interface JellyfinIndexEntry {
  id: string;
  name: string;
  type: string;
  path: string;
}

export interface JellyfinIndex {
  /** Items that exposed a usable Path */
  entries: JellyfinIndexEntry[];
  /** Items Jellyfin returned without a Path field */
  itemsWithoutPath: number;
  /** Total Movie/Episode items reported */
  totalReported: number;
}

/** Normalize a filesystem path for tolerant comparisons across mounts/SMB. */
function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .toLowerCase()
    .replace(/\/$/, "");
}

/**
 * Fetch every Movie/Episode item Jellyfin has indexed (paginated) with its
 * file path, so callers can diff against the on-disk library.
 */
export async function listIndexedFiles(
  settings: AppSettings,
): Promise<JellyfinIndex> {
  const entries: JellyfinIndexEntry[] = [];
  let itemsWithoutPath = 0;
  let totalReported = 0;

  for (let start = 0; ; start += PAGE_SIZE) {
    const params = new URLSearchParams({
      recursive: "true",
      includeItemTypes: "Movie,Episode",
      fields: "Path",
      startIndex: String(start),
      limit: String(PAGE_SIZE),
    });
    const page = await jellyfinFetch<{ Items?: JellyfinItemDto[]; TotalRecordCount?: number }>(
      settings,
      `/Items?${params.toString()}`,
      { timeoutMs: 30_000 },
    );
    const items = page.Items || [];
    totalReported += items.length;
    for (const item of items) {
      if (!item.Id) continue;
      if (!item.Path) {
        itemsWithoutPath++;
        continue;
      }
      entries.push({
        id: item.Id,
        name: item.Name || "",
        type: item.Type || "",
        path: normalizePath(item.Path),
      });
    }
    if (items.length < PAGE_SIZE) break;
  }
  return { entries, itemsWithoutPath, totalReported };
}

export interface JellyfinPathMatcher {
  matches(filePath: string): boolean;
}

/**
 * Match local files against Jellyfin's index in two tiers:
 * exact normalized path first, then file name only — tolerant of Jellyfin
 * seeing the libraries under a different mount point than this app.
 */
export function buildPathMatcher(
  index: JellyfinIndex,
): JellyfinPathMatcher {
  const exact = new Set(index.entries.map((e) => e.path));
  const basenames = new Set<string>();
  for (const entry of index.entries) {
    const base = entry.path.split("/").pop();
    if (base) basenames.add(base);
  }
  return {
    matches(filePath: string) {
      const norm = normalizePath(filePath);
      if (exact.has(norm)) return true;
      const base = norm.split("/").pop();
      return Boolean(base && basenames.has(base));
    },
  };
}

/** Ask Jellyfin to rescan all libraries so new files get metadata. */
export async function triggerLibraryScan(settings: AppSettings): Promise<void> {
  const base = settings.jellyfinUrl.trim().replace(/\/$/, "");
  const timeoutMs = 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/Library/Refresh`, {
      method: "POST",
      headers: authHeaders(settings.jellyfinApiKey),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 204) {
      throw new JellyfinError(
        `Jellyfin library scan failed (${res.status})`,
        res.status,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new JellyfinError("Jellyfin library scan request timed out", 504);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export { normalizePath };

/**
 * Find the Jellyfin item id for a local library entry by matching its file
 * paths against Jellyfin's index. Movies match directly; series resolve to
 * the parent SeriesId of any indexed episode.
 */
export async function findJellyfinItemIdByPaths(
  settings: AppSettings,
  type: "movie" | "series",
  filePaths: string[],
): Promise<string | null> {
  const wantedExact = new Set(filePaths.map(normalizePath));
  const wantedBase = new Set(
    filePaths
      .map((p) => normalizePath(p).split("/").pop())
      .filter((b): b is string => Boolean(b)),
  );
  const matches = (p?: string) => {
    if (!p) return false;
    const norm = normalizePath(p);
    if (wantedExact.has(norm)) return true;
    const base = norm.split("/").pop();
    return Boolean(base && wantedBase.has(base));
  };

  for (let start = 0; ; start += PAGE_SIZE) {
    const params = new URLSearchParams({
      recursive: "true",
      includeItemTypes: type === "movie" ? "Movie" : "Episode",
      fields: "Path",
      startIndex: String(start),
      limit: String(PAGE_SIZE),
    });
    const page = await jellyfinFetch<{
      Items?: Array<JellyfinItemDto & { SeriesId?: string }>;
    }>(settings, `/Items?${params.toString()}`, { timeoutMs: 30_000 });
    const items = page.Items || [];

    if (type === "movie") {
      const hit = items.find((item) => item.Id && matches(item.Path));
      if (hit?.Id) return hit.Id;
    } else {
      const hit = items.find((item) => item.SeriesId && matches(item.Path));
      if (hit?.SeriesId) return hit.SeriesId;
    }
    if (items.length < PAGE_SIZE) return null;
  }
}

/** Ask Jellyfin to re-read metadata/images for one specific item. */
export async function refreshJellyfinItem(
  settings: AppSettings,
  itemId: string,
): Promise<void> {
  const base = settings.jellyfinUrl.trim().replace(/\/$/, "");
  const params = new URLSearchParams({
    metadataRefreshMode: "FullRefresh",
    imageRefreshMode: "FullRefresh",
    replaceAllMetadata: "false",
    replaceAllImages: "false",
  });
  const timeoutMs = 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${base}/Items/${encodeURIComponent(itemId)}/Refresh?${params.toString()}`,
      {
        method: "POST",
        headers: authHeaders(settings.jellyfinApiKey),
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!res.ok && res.status !== 204) {
      throw new JellyfinError(
        `Jellyfin metadata refresh failed (${res.status})`,
        res.status,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new JellyfinError("Jellyfin metadata refresh request timed out", 504);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
