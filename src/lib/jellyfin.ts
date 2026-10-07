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

/** Current Jellyfin auth scheme. Avoid X-Emby-Token — Jellyfin 12+ rejects it. */
function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `MediaBrowser Client="TorBoxDownloader", Device="Server", DeviceId="torbox-downloader", Version="0.1.0", Token="${apiKey}"`,
  };
}

function jellyfinUrl(
  settings: AppSettings,
  path: string,
): { base: string; url: string; apiKey: string } {
  const base = settings.jellyfinUrl.trim().replace(/\/$/, "");
  const apiKey = settings.jellyfinApiKey.trim();
  if (!base) throw new JellyfinError("Jellyfin URL is not set");
  if (!apiKey) throw new JellyfinError("Jellyfin API key is not set");

  // api_key query survives reverse proxies that strip Authorization.
  const sep = path.includes("?") ? "&" : "?";
  return {
    base,
    apiKey,
    url: `${base}${path}${sep}api_key=${encodeURIComponent(apiKey)}`,
  };
}

function elevationHint(status?: number): string {
  if (status === 401 || status === 403) {
    return " — use an API key created by a Jellyfin admin account";
  }
  return "";
}

async function jellyfinRequest(
  settings: AppSettings,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { url, apiKey } = jellyfinUrl(settings, path);
  const { timeoutMs: timeoutOpt, ...fetchInit } = init || {};
  const timeoutMs = timeoutOpt ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const method = (fetchInit.method || "GET").toUpperCase();

  try {
    // Empty string body forces Content-Length: 0 on POST/PUT — some proxies
    // (nginx/Traefik) mishandle bodiless POST and return 502.
    const needsEmptyBody =
      fetchInit.body === undefined && (method === "POST" || method === "PUT");

    return await fetch(url, {
      ...fetchInit,
      method,
      headers: {
        ...authHeaders(apiKey),
        ...(fetchInit.headers || {}),
      },
      body: needsEmptyBody ? "" : fetchInit.body,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new JellyfinError(
        `Jellyfin request timed out after ${timeoutMs}ms`,
        504,
      );
    }
    if (
      err instanceof Error &&
      /fetch failed|econn|enotfound|cert|ssl|tls/i.test(err.message)
    ) {
      throw new JellyfinError(
        `Could not reach the Jellyfin server at ${settings.jellyfinUrl}`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function jellyfinFetch<T>(
  settings: AppSettings,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const res = await jellyfinRequest(settings, path, init);
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // ignore body read failures
    }
    throw new JellyfinError(
      `Jellyfin request failed (${res.status})${detail ? `: ${detail}` : ""}${elevationHint(res.status)}`,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** POST that expects 204/empty success (library scan, item refresh). */
async function jellyfinPostEmpty(
  settings: AppSettings,
  path: string,
  failureLabel: string,
  timeoutMs = 30_000,
): Promise<void> {
  const res = await jellyfinRequest(settings, path, {
    method: "POST",
    timeoutMs,
  });
  if (res.ok || res.status === 204) return;
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 200);
  } catch {
    // ignore
  }
  throw new JellyfinError(
    `${failureLabel} (${res.status})${detail ? `: ${detail}` : ""}${elevationHint(res.status)}`,
    res.status,
  );
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

/**
 * Ask Jellyfin to rescan all libraries so new files get metadata.
 * Tries /Library/Refresh first, then the scheduled "Scan Media Library" task.
 */
export async function triggerLibraryScan(settings: AppSettings): Promise<void> {
  try {
    await jellyfinPostEmpty(
      settings,
      "/Library/Refresh",
      "Jellyfin library scan failed",
    );
    return;
  } catch (err) {
    // Fall through to scheduled task when Refresh is blocked or unavailable.
    if (
      !(err instanceof JellyfinError) ||
      (err.status !== 401 &&
        err.status !== 403 &&
        err.status !== 404 &&
        err.status !== 405 &&
        err.status !== 502 &&
        err.status !== 503)
    ) {
      throw err;
    }
  }

  await startScanMediaLibraryTask(settings);
}

interface ScheduledTaskDto {
  Id?: string;
  Key?: string;
  Name?: string;
}

/** Start Jellyfin's built-in Scan Media Library scheduled task. */
async function startScanMediaLibraryTask(
  settings: AppSettings,
): Promise<void> {
  const tasks = await jellyfinFetch<ScheduledTaskDto[]>(
    settings,
    "/ScheduledTasks",
    { timeoutMs: 20_000 },
  );
  const scanTask = (tasks || []).find(
    (t) =>
      t.Id &&
      (t.Key === "RefreshLibrary" ||
        /scan media library/i.test(t.Name || "")),
  );
  if (!scanTask?.Id) {
    throw new JellyfinError(
      "Could not find Jellyfin's Scan Media Library task",
      404,
    );
  }
  await jellyfinPostEmpty(
    settings,
    `/ScheduledTasks/Running/${encodeURIComponent(scanTask.Id)}`,
    "Jellyfin library scan failed",
  );
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
  const params = new URLSearchParams({
    metadataRefreshMode: "FullRefresh",
    imageRefreshMode: "FullRefresh",
    replaceAllMetadata: "false",
    replaceAllImages: "false",
  });
  await jellyfinPostEmpty(
    settings,
    `/Items/${encodeURIComponent(itemId)}/Refresh?${params.toString()}`,
    "Jellyfin metadata refresh failed",
  );
}
