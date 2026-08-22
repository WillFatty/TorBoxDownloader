import { beginRemux, isRemuxActive, markRemuxQueued } from "./remux-progress";

interface QueuedTask {
  start: () => Promise<void>;
}

const tasks: QueuedTask[] = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (tasks.length) {
      const task = tasks.shift()!;
      // Failure state is recorded by the task itself via finishRemux.
      await task.start().catch(() => undefined);
    }
  } finally {
    draining = false;
  }
}

/**
 * Queue a remux to run sequentially in the background so the HTTP request
 * returns immediately — long-running ffmpeg inside a request causes gateway
 * timeouts (504s) on movie-sized files.
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
  void drain();
  return true;
}

/** Transition a queued entry to working right before its ffmpeg run. */
export function startQueuedRemux(filePath: string): void {
  if (!isRemuxActive(filePath)) return;
  beginRemux(filePath);
}
