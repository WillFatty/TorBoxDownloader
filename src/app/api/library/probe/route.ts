import path from "path";
import { NextResponse } from "next/server";
import {
  isFfprobeAvailable,
  probeManyMediaLanguages,
} from "@/lib/media-probe";

const MAX_FILES = 80;

export async function POST(request: Request) {
  try {
    if (!(await isFfprobeAvailable())) {
      return NextResponse.json({
        available: false,
        languages: {},
        error: "ffprobe is not installed on the server",
      });
    }

    const body = (await request.json()) as { files?: unknown };
    const files: string[] = [];
    if (Array.isArray(body.files)) {
      for (const entry of body.files.slice(0, MAX_FILES)) {
        if (typeof entry === "string" && entry.trim()) {
          files.push(path.resolve(entry.trim()));
        }
      }
    }

    if (!files.length) {
      return NextResponse.json({ available: true, languages: {} });
    }

    const languages = await probeManyMediaLanguages(files);
    return NextResponse.json({ available: true, languages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Probe failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
