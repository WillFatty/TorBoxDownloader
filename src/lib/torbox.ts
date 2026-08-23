const TORBOX = "https://api.torbox.app/v1";
const DEFAULT_TIMEOUT_MS = 25_000;

export class TorBoxError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TorBoxError";
  }
}

const TRANSIENT_CODES = new Set([
  "DATABASE_ERROR",
  "UNKNOWN_ERROR",
  "TIMEOUT",
]);

export function isTransientTorBoxError(err: unknown): boolean {
  if (err instanceof TorBoxError) {
    if (err.status != null && err.status >= 500) return true;
    if (err.status === 429) return true;
    const code = (err.code || "").toUpperCase();
    if (TRANSIENT_CODES.has(code)) return true;
    return /database_error|try again later|temporarily|timed out|rate limit/i.test(
      err.message,
    );
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    return /timeout|network|fetch failed|econnreset|etimedout/i.test(
      err.message,
    );
  }
  return false;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseMs?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? 5;
  const baseMs = opts?.baseMs ?? 800;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransientTorBoxError(err) || i === attempts - 1) throw err;
      const backoff =
        Math.min(12_000, baseMs * 2 ** i) + Math.floor(Math.random() * 300);
      const retryAfterMs =
        err instanceof TorBoxError ? err.retryAfterMs || 0 : 0;
      await sleep(Math.max(backoff, retryAfterMs));
    }
  }
  throw last;
}

/** Serialize link requests so parallel jobs don't hammer requestdl. */
let linkChain: Promise<void> = Promise.resolve();

function enqueueExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = linkChain.then(fn, fn);
  linkChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Keep at least this much space between any two mylist API calls. */
let lastListAt = 0;
const LIST_MIN_GAP_MS = 1200;

async function throttledCall<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    const wait = lastListAt + LIST_MIN_GAP_MS - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  lastListAt = Date.now();
  return fn();
}

async function torboxFetch(
  apiKey: string,
  path: string,
  init?: RequestInit & { form?: Record<string, string>; timeoutMs?: number },
) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);

  let body = init?.body;
  if (init?.form) {
    const form = new FormData();
    for (const [k, v] of Object.entries(init.form)) {
      if (v !== undefined && v !== null) form.append(k, v);
    }
    body = form;
  }

  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${TORBOX}${path}`, {
      method: init?.method,
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      error?: string;
      detail?: string;
      data?: unknown;
    } | null;

    if (!res.ok || json?.success === false) {
      const code = typeof json?.error === "string" ? json.error : undefined;
      const retryAfterRaw = Number(res.headers.get("retry-after"));
      const retryAfterMs =
        Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
          ? Math.min(60_000, retryAfterRaw * 1000)
          : undefined;
      const message =
        json?.detail ||
        code ||
        (res.status === 429
          ? "TorBox rate limit hit — will retry"
          : `TorBox request failed (${res.status})`);
      throw new TorBoxError(message, res.status, code, retryAfterMs);
    }
    return json;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || /aborted/i.test(err.message))
    ) {
      throw new TorBoxError(
        `TorBox request timed out after ${timeoutMs}ms`,
        504,
        "TIMEOUT",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface TorBoxFile {
  id: number;
  name: string;
  size: number;
  mime_type?: string;
}

export interface TorBoxTorrent {
  id: number;
  hash: string;
  name: string;
  size: number;
  download_state: string;
  progress: number;
  download_finished: boolean;
  files?: TorBoxFile[];
}

/** Normalize TorBox progress to 0–1 (API may send 0–1 or 0–100). */
export function normalizeTorrentProgress(
  progress: number | null | undefined,
): number {
  if (progress == null || !Number.isFinite(progress)) return 0;
  if (progress > 1) return Math.min(1, progress / 100);
  return Math.max(0, Math.min(1, progress));
}

export async function createTorrent(
  apiKey: string,
  magnet: string,
  name?: string,
): Promise<{ torrent_id: number; hash: string }> {
  return withRetry(async () => {
    const json = await torboxFetch(apiKey, "/api/torrents/createtorrent", {
      method: "POST",
      form: {
        magnet,
        ...(name ? { name } : {}),
      },
      timeoutMs: 45_000,
    });
    const data = json?.data as { torrent_id?: number; hash?: string } | undefined;
    if (data?.torrent_id == null) {
      throw new TorBoxError("TorBox did not return a torrent id");
    }
    return {
      torrent_id: data.torrent_id,
      hash: data.hash || "",
    };
  });
}

export async function getTorrentList(
  apiKey: string,
  opts?: { id?: number; bypassCache?: boolean },
): Promise<TorBoxTorrent | TorBoxTorrent[]> {
  const params = new URLSearchParams();
  if (opts?.id != null) params.set("id", String(opts.id));
  if (opts?.bypassCache) params.set("bypass_cache", "true");
  const qs = params.toString();
  const json = await withRetry(
    () =>
      throttledCall(() =>
        torboxFetch(apiKey, `/api/torrents/mylist${qs ? `?${qs}` : ""}`, {
          timeoutMs: 20_000,
        }),
      ),
    { attempts: 3, baseMs: 600 },
  );
  return json?.data as TorBoxTorrent | TorBoxTorrent[];
}

export async function getTorrentById(
  apiKey: string,
  id: number,
  opts?: { bypassCache?: boolean },
): Promise<TorBoxTorrent | null> {
  const data = await getTorrentList(apiKey, {
    id,
    bypassCache: opts?.bypassCache ?? true,
  });
  if (!data) return null;
  return Array.isArray(data) ? data[0] || null : data;
}

export async function checkCached(
  apiKey: string,
  hashes: string[],
): Promise<Record<string, boolean>> {
  if (!hashes.length) return {};
  const unique = [
    ...new Set(hashes.map((h) => h.trim().toLowerCase()).filter(Boolean)),
  ];
  const out: Record<string, boolean> = {};
  for (const hash of unique) out[hash] = false;

  const chunkSize = 40;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      Object.assign(out, await checkCachedChunk(apiKey, chunk));
    } catch {
      // Soft-fail: keep unknown/false badges rather than breaking stream list
    }
  }
  return out;
}

function markCached(
  out: Record<string, boolean>,
  hash: string | undefined | null,
) {
  if (!hash) return;
  out[hash.trim().toLowerCase()] = true;
}

function parseCachedPayload(
  data: unknown,
  requested: string[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const hash of requested) out[hash] = false;
  if (!data) return out;

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "string") {
        markCached(out, item);
      } else if (item && typeof item === "object") {
        const row = item as { hash?: string; infoHash?: string };
        markCached(out, row.hash || row.infoHash);
      }
    }
    return out;
  }

  if (typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const hash = key.trim().toLowerCase();
      if (value === false || value === null || value === 0 || value === "false") {
        out[hash] = false;
      } else if (
        value === true ||
        typeof value === "object" ||
        value === "true"
      ) {
        out[hash] = true;
      }
    }
  }
  return out;
}

async function checkCachedChunk(
  apiKey: string,
  hashes: string[],
): Promise<Record<string, boolean>> {
  const params = new URLSearchParams();
  params.set("hash", hashes.join(","));
  params.set("format", "list");

  const json = await withRetry(
    () =>
      torboxFetch(apiKey, `/api/torrents/checkcached?${params.toString()}`, {
        timeoutMs: 20_000,
      }),
    { attempts: 3, baseMs: 600 },
  );
  return parseCachedPayload(json?.data, hashes);
}

/** Comet often marks debrid cache in name/title when TorBox configured on instance. */
export function detectCachedHint(
  ...parts: Array<string | null | undefined>
): boolean | null {
  const blob = parts.filter(Boolean).join("\n");
  if (!blob) return null;
  if (
    /📦|⚡|\[\s*cached\s*\]|\bcached\b|\binstant\b/i.test(blob) &&
    !/\buncached\b|\bnot cached\b/i.test(blob)
  ) {
    return true;
  }
  if (/\buncached\b|\bdownload\b.*\brequired\b/i.test(blob)) {
    return false;
  }
  return null;
}

export async function requestDownloadLink(
  apiKey: string,
  torrentId: number,
  fileId: number,
): Promise<string> {
  return enqueueExclusive(() =>
    withRetry(
      async () => {
        const params = new URLSearchParams({
          token: apiKey,
          torrent_id: String(torrentId),
          file_id: String(fileId),
        });
        const json = await torboxFetch(
          apiKey,
          `/api/torrents/requestdl?${params.toString()}`,
          { timeoutMs: 30_000 },
        );
        const link = json?.data;
        if (typeof link !== "string" || !link) {
          throw new TorBoxError("TorBox did not return a download link");
        }
        return link;
      },
      { attempts: 6, baseMs: 700 },
    ),
  );
}

export function pickBestVideoFile(
  files: TorBoxFile[] | undefined,
  preferredIdx: number | null,
): TorBoxFile | null {
  if (!files?.length) return null;
  if (preferredIdx != null && files[preferredIdx]) return files[preferredIdx];

  const videoExt = /\.(mkv|mp4|avi|m4v|ts|mov)$/i;
  const videos = files.filter((f) => videoExt.test(f.name));
  const pool = videos.length ? videos : files;
  return pool.reduce((best, f) => (f.size > best.size ? f : best), pool[0]);
}

export function isTorrentReady(t: TorBoxTorrent): boolean {
  if (t.download_finished) return true;
  if (normalizeTorrentProgress(t.progress) >= 1) return true;
  const state = (t.download_state || "").toLowerCase();
  // TorBox docs: don't use "completed" alone for readiness
  return state === "cached" || state === "uploading";
}
