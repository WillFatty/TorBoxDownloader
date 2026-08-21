const TORBOX = "https://api.torbox.app/v1";

export class TorBoxError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "TorBoxError";
  }
}

async function torboxFetch(
  apiKey: string,
  path: string,
  init?: RequestInit & { form?: Record<string, string> },
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

  const res = await fetch(`${TORBOX}${path}`, {
    ...init,
    headers,
    body,
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    detail?: string;
    data?: unknown;
  } | null;

  if (!res.ok || json?.success === false) {
    throw new TorBoxError(
      json?.error || json?.detail || `TorBox request failed (${res.status})`,
      res.status,
    );
  }
  return json;
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

export async function createTorrent(
  apiKey: string,
  magnet: string,
  name?: string,
): Promise<{ torrent_id: number; hash: string }> {
  const json = await torboxFetch(apiKey, "/api/torrents/createtorrent", {
    method: "POST",
    form: {
      magnet,
      ...(name ? { name } : {}),
    },
  });
  const data = json?.data as { torrent_id?: number; hash?: string } | undefined;
  if (data?.torrent_id == null) {
    throw new TorBoxError("TorBox did not return a torrent id");
  }
  return {
    torrent_id: data.torrent_id,
    hash: data.hash || "",
  };
}

export async function getTorrentList(
  apiKey: string,
  opts?: { id?: number; bypassCache?: boolean },
): Promise<TorBoxTorrent | TorBoxTorrent[]> {
  const params = new URLSearchParams();
  if (opts?.id != null) params.set("id", String(opts.id));
  if (opts?.bypassCache) params.set("bypass_cache", "true");
  const qs = params.toString();
  const json = await torboxFetch(
    apiKey,
    `/api/torrents/mylist${qs ? `?${qs}` : ""}`,
  );
  return json?.data as TorBoxTorrent | TorBoxTorrent[];
}

export async function getTorrentById(
  apiKey: string,
  id: number,
): Promise<TorBoxTorrent | null> {
  const data = await getTorrentList(apiKey, { id, bypassCache: true });
  if (!data) return null;
  return Array.isArray(data) ? data[0] || null : data;
}

export async function checkCached(
  apiKey: string,
  hashes: string[],
): Promise<Record<string, boolean>> {
  if (!hashes.length) return {};
  const unique = [...new Set(hashes.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  const out: Record<string, boolean> = {};
  for (const hash of unique) out[hash] = false;

  const chunkSize = 40;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    Object.assign(out, await checkCachedChunk(apiKey, chunk));
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

  // format=list → [{ hash, name, size }, ...] (only cached entries)
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

  // format=object → { [hash]: true | false | { name, size, ... } }
  if (typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const hash = key.trim().toLowerCase();
      if (value === false || value === null || value === 0 || value === "false") {
        out[hash] = false;
      } else if (value === true || typeof value === "object" || value === "true") {
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
  // Prefer list format — unambiguous array of cached hashes
  const params = new URLSearchParams();
  params.set("hash", hashes.join(","));
  params.set("format", "list");

  const json = await torboxFetch(
    apiKey,
    `/api/torrents/checkcached?${params.toString()}`,
  );
  return parseCachedPayload(json?.data, hashes);
}

/** Comet often marks debrid cache in name/title when TorBox configured on instance. */
export function detectCachedHint(...parts: Array<string | null | undefined>): boolean | null {
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
  const params = new URLSearchParams({
    token: apiKey,
    torrent_id: String(torrentId),
    file_id: String(fileId),
  });
  const json = await torboxFetch(
    apiKey,
    `/api/torrents/requestdl?${params.toString()}`,
  );
  const link = json?.data;
  if (typeof link !== "string" || !link) {
    throw new TorBoxError("TorBox did not return a download link");
  }
  return link;
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
  const state = (t.download_state || "").toLowerCase();
  return state === "cached" || state === "completed" || state === "uploading";
}
