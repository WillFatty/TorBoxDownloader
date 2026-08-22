import path from "path";

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

const TTL_MS = 10 * 60 * 1000;
const entries = new Map<string, StoreEntry>();

function prune() {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.status !== "working" && now - entry.updatedAt > TTL_MS) {
      entries.delete(key);
    }
  }
}

function keyOf(filePath: string): string {
  return path.resolve(filePath);
}

export function beginRemux(filePath: string): void {
  entries.set(keyOf(filePath), {
    status: "working",
    percent: 0,
    updatedAt: Date.now(),
  });
}

export function markRemuxQueued(filePath: string): void {
  entries.set(keyOf(filePath), {
    status: "queued",
    percent: 0,
    updatedAt: Date.now(),
  });
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
    return;
  }
  entries.set(key, {
    status: outcome.skipped ? "skipped" : "done",
    percent: 100,
    updatedAt: Date.now(),
  });
}

export interface RemuxLogEntry extends RemuxProgressEntry {
  file: string;
  fileName: string;
  updatedAt: string;
}

/** All tracked remux entries (pruned), newest activity first. */
export function listRemuxEntries(): RemuxLogEntry[] {
  prune();
  return [...entries.entries()]
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .map(([key, entry]) => ({
      file: key,
      fileName: path.basename(key),
      status: entry.status,
      percent: entry.percent,
      ...(entry.error ? { error: entry.error } : {}),
      updatedAt: new Date(entry.updatedAt).toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getRemuxProgress(
  files: string[],
): Record<string, RemuxProgressEntry> {
  prune();
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
