import path from "path";
import { STORE_KEYS, storeGetJSON, storeSetJSON } from "./store";

export type RemuxStatus =
  | "queued"
  | "working"
  | "done"
  | "failed"
  | "skipped";

export interface RemuxProgressEntry {
  status: RemuxStatus;
  percent: number;
  error?: string;
}

interface StoreEntry extends RemuxProgressEntry {
  updatedAt: number;
}

interface StoredEntry extends StoreEntry {
  file: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const LOG_FILE = path.join(DATA_DIR, "remux-log.json");
const MAX_ENTRIES = 500;

const entries = new Map<string, StoreEntry>();

function keyOf(filePath: string): string {
  return path.resolve(filePath);
}

async function load(): Promise<void> {
  let parsed: unknown;
  try {
    parsed = await storeGetJSON<StoredEntry[]>(STORE_KEYS.remuxLog, LOG_FILE);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const item of parsed as StoredEntry[]) {
    if (!item || typeof item.file !== "string" || !item.status) continue;
    const orphaned = item.status === "queued" || item.status === "working";
    entries.set(item.file, {
      status: orphaned ? "failed" : item.status,
      percent: Number(item.percent) || 0,
      error: orphaned
        ? "Interrupted by server restart"
        : item.error
          ? String(item.error)
          : undefined,
      updatedAt: Number(item.updatedAt) || 0,
    });
  }
}

void load();

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(delayMs: number): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void save();
  }, delayMs);
}

function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void save();
}

async function save(): Promise<void> {
  if (entries.size > MAX_ENTRIES) {
    const overflow = [...entries.entries()]
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
      .slice(0, entries.size - MAX_ENTRIES);
    for (const [key] of overflow) entries.delete(key);
  }
  const list: StoredEntry[] = [...entries.entries()]
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .map(([file, entry]) => ({ file, ...entry }));
  try {
    await storeSetJSON(STORE_KEYS.remuxLog, list, LOG_FILE);
  } catch {
    return;
  }
}

export function beginRemux(filePath: string): void {
  entries.set(keyOf(filePath), {
    status: "working",
    percent: 0,
    updatedAt: Date.now(),
  });
  scheduleSave(300);
}

export function markRemuxQueued(filePath: string): void {
  entries.set(keyOf(filePath), {
    status: "queued",
    percent: 0,
    updatedAt: Date.now(),
  });
  scheduleSave(300);
}

export function isRemuxActive(filePath: string): boolean {
  const entry = entries.get(keyOf(filePath));
  return entry?.status === "queued" || entry?.status === "working";
}

export function updateRemuxPercent(
  filePath: string,
  percent: number,
): void {
  const entry = entries.get(keyOf(filePath));
  if (!entry || entry.status !== "working") return;
  if (percent <= entry.percent) return;
  entry.percent = Math.min(100, Math.max(0, Math.round(percent)));
  entry.updatedAt = Date.now();
  scheduleSave(800);
}

export function finishRemux(
  filePath: string,
  outcome:
    | { ok: true; skipped?: boolean }
    | { ok: false; error: string },
): void {
  const key = keyOf(filePath);
  const previous = entries.get(key);
  if (!outcome.ok) {
    entries.set(key, {
      status: "failed",
      percent: previous?.percent ?? 0,
      error: outcome.error,
      updatedAt: Date.now(),
    });
  } else {
    entries.set(key, {
      status: outcome.skipped ? "skipped" : "done",
      percent: 100,
      updatedAt: Date.now(),
    });
  }
  flushSave();
}

export interface RemuxLogEntry extends RemuxProgressEntry {
  file: string;
  fileName: string;
  updatedAt: string;
}

/** All tracked remux entries, newest activity first. */
export function listRemuxEntries(): RemuxLogEntry[] {
  return [...entries.entries()]
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .map(([key, entry]) => ({
      file: key,
      fileName: path.basename(key),
      status: entry.status,
      percent: entry.percent,
      ...(entry.error ? { error: entry.error } : {}),
      updatedAt: new Date(entry.updatedAt).toISOString(),
    }));
}

export function getRemuxProgress(
  files: string[],
): Record<string, RemuxProgressEntry> {
  const out: Record<string, RemuxProgressEntry> = {};
  for (const file of files) {
    const entry = entries.get(keyOf(file));
    if (entry) {
      out[file] = {
        status: entry.status,
        percent: entry.percent,
        ...(entry.error ? { error: entry.error } : {}),
      };
    }
  }
  return out;
}
