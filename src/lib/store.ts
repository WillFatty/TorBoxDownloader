import { existsSync, promises as fs } from "fs";
import path from "path";
import { createClient, type RedisClientType } from "redis";

export type StorageBackend = "redis" | "file";

/** Resolved lazily so .env (loaded first in src/server/env.ts) always wins. */
export function storageBackend(): StorageBackend {
  const raw = process.env.STORAGE_BACKEND?.trim().toLowerCase();
  if (raw === "file" || raw === "json") return "file";
  if (!raw || raw === "redis") return "redis";
  console.warn(`[storage] unknown STORAGE_BACKEND "${raw}" — using "file"`);
  return "file";
}

function redisUrl(): string {
  const explicit = process.env.REDIS_URL?.trim();
  if (explicit) return explicit;
  const host = process.env.REDIS_HOST?.trim() || "192.168.0.208";
  const port = Number(process.env.REDIS_PORT) || 6379;
  const username = process.env.REDIS_USERNAME?.trim() || "";
  const password = process.env.REDIS_PASSWORD?.trim() || "";
  const auth =
    password || username
      ? `${encodeURIComponent(username || "default")}:${encodeURIComponent(password)}@`
      : "";
  return `redis://${auth}${host}:${port}`;
}

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

async function getClient(): Promise<RedisClientType> {
  if (client?.isReady) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const c = createClient({
      url: redisUrl(),
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => Math.min(retries * 250, 3000),
      },
      // Commands fail fast while offline instead of hanging API routes.
      disableOfflineQueue: true,
    }) as RedisClientType;

    c.on("error", (err) => {
      console.error("[redis] error:", err.message);
    });

    await c.connect();
    client = c;
    return c;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

async function readFileJSON<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

/**
 * Read a JSON document.
 *
 * - file backend: reads `legacyFile` (the canonical location in this mode).
 * - redis backend: reads the key; when absent, a legacy JSON file
 *   (the old data/*.json stores) is imported into Redis once.
 */
export async function storeGetJSON<T>(
  key: string,
  legacyFile?: string,
): Promise<T | null> {
  if (storageBackend() === "file") {
    if (!legacyFile) return null;
    try {
      return await readFileJSON<T>(legacyFile);
    } catch (err) {
      console.error(
        `[storage] failed to read ${legacyFile}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  const c = await getClient();
  let raw: string | null = null;
  try {
    raw = await c.get(key);
  } catch (err) {
    // Fall back to the legacy file when Redis is unreachable.
    if (legacyFile && existsSync(legacyFile)) {
      return JSON.parse(await fs.readFile(legacyFile, "utf8")) as T;
    }
    throw err;
  }
  if (raw != null) return JSON.parse(raw) as T;

  if (legacyFile && existsSync(legacyFile)) {
    const imported = JSON.parse(await fs.readFile(legacyFile, "utf8")) as T;
    try {
      await c.set(key, JSON.stringify(imported));
    } catch {
      // Import persistence is best-effort.
    }
    return imported;
  }
  return null;
}

/** Write a JSON document to the active backend (`legacyFile` is the file path). */
export async function storeSetJSON(
  key: string,
  value: unknown,
  legacyFile?: string,
): Promise<void> {
  if (storageBackend() === "file") {
    if (!legacyFile) return;
    await fs.mkdir(path.dirname(legacyFile), { recursive: true });
    await fs.writeFile(legacyFile, JSON.stringify(value, null, 2), "utf8");
    return;
  }
  const c = await getClient();
  await c.set(key, JSON.stringify(value));
}

export const STORE_KEYS = {
  settings: "tbd:settings",
  jobs: "tbd:jobs",
  artworkCache: "tbd:artwork-cache",
  probeCache: "tbd:media-probe-cache",
  remuxLog: "tbd:remux-log",
  libraryCache: "tbd:library-cache",
  ratingsCache: "tbd:ratings-cache",
} as const;
