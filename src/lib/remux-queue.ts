import { availableParallelism } from "os";
import { beginRemux, isRemuxActive, markRemuxQueued } from "./remux-progress";

interface QueuedTask {
  start: () => Promise<void>;
}

const tasks: QueuedTask[] = [];

// Each remux is `-c copy`, so one ffmpeg process barely uses a core.
// Parallelism comes from running one remux per CPU. Override with
// REMUX_CONCURRENCY.
const envConcurrency = Number(process.env.REMUX_CONCURRENCY);
const MAX_CONCURRENT_REMUXES =
  Number.isFinite(envConcurrency) && envConcurrency >= 1
    ? Math.floor(envConcurrency)
    : Math.max(1, availableParallelism());
let running = 0;

function pump() {
  while (running < MAX_CONCURRENT_REMUXES && tasks.length) {
    const task = tasks.shift()!;
    running += 1;
    // Failure state is recorded by the task itself via finishRemux.
    task
      .start()
      .catch(() => undefined)
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

/**
 * Queue a remux to run in the background so the HTTP request returns
 * immediately — long-running ffmpeg inside a request causes gateway timeouts
 * (504s) on movie-sized files. Up to MAX_CONCURRENT_REMUXES ffmpeg processes
 * run in parallel; each remux works on its own files so this is safe.
 *
 * Returns false when the file already has an active (queued/working) remux.
 */
export function scheduleRemux(
  filePath: string,
  start: () => Promise<void>,
): boolean {
  if (isRemuxActive(filePath)) return false;
  markRemuxQueued(filePath);
  tasks.push({ start });
  pump();
  return true;
}

/** Transition a queued entry to working right before its ffmpeg run. */
export function startQueuedRemux(filePath: string): void {
  if (!isRemuxActive(filePath)) return;
  beginRemux(filePath);
}
