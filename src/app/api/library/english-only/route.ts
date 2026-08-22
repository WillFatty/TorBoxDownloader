import path from "path";
import { NextResponse } from "next/server";
import {
  isFfmpegAvailable,
  remuxEnglishOnly,
} from "@/lib/media-english";

const MAX_FILES = 40;

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

    // One file per request keeps the HTTP call responsive on big seasons.
    if (unique.length === 1) {
      const result = await remuxEnglishOnly(unique[0]);
      return NextResponse.json({ results: [result] });
    }

    const results = [];
    for (const file of unique) {
      results.push(await remuxEnglishOnly(file));
    }
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "English-only remux failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
