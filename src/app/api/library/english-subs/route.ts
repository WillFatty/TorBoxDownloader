import path from "path";
import { NextResponse } from "next/server";
import {
  isFfmpegAvailable,
  remuxEnglishSubsOnly,
} from "@/lib/media-english";
import { scheduleRemux, startQueuedRemux } from "@/lib/remux-queue";
import {
  finishRemux,
  getRemuxProgress,
  updateRemuxPercent,
} from "@/lib/remux-progress";

const MAX_FILES = 40;

function remuxTracked(file: string): Promise<void> {
  return (async () => {
    startQueuedRemux(file);
    try {
      const result = await remuxEnglishSubsOnly(file, (percent) =>
        updateRemuxPercent(file, percent),
      );
      finishRemux(file, { ok: true, skipped: result.skipped });
    } catch (err) {
      finishRemux(file, {
        ok: false,
        error: err instanceof Error ? err.message : "Subtitle cleanup failed",
      });
    }
  })();
}

export async function POST(request: Request) {
  try {
    if (!(await isFfmpegAvailable())) {
      return NextResponse.json(
        { error: "ffmpeg is not available on the server" },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { files?: unknown; file?: unknown };
    const files: string[] = [];

    if (typeof body.file === "string" && body.file.trim()) {
      files.push(path.resolve(body.file.trim()));
    }
    if (Array.isArray(body.files)) {
      for (const entry of body.files.slice(0, MAX_FILES)) {
        if (typeof entry === "string" && entry.trim()) {
          files.push(path.resolve(entry.trim()));
        }
      }
    }

    const unique = [...new Set(files)];
    if (!unique.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Queue everything and return immediately — ffmpeg runs in the background
    // (sequentially) so the request can't hit gateway timeouts on big files.
    let queued = 0;
    for (const file of unique) {
      if (scheduleRemux(file, () => remuxTracked(file))) queued += 1;
    }
    return NextResponse.json({ queued });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Subtitle cleanup failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("files");
  let files: string[] = [];

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        files = parsed
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, MAX_FILES * 4);
      }
    } catch {
      // Fall through to empty result below.
    }
  }

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  return NextResponse.json({ progress: getRemuxProgress(files) });
}
