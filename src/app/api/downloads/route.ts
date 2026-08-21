import { NextResponse } from "next/server";
import { downloadManager } from "@/lib/download-manager";
import { buildJellyfinPaths } from "@/lib/naming";
import type { CreateDownloadInput, MediaType } from "@/lib/types";

export async function GET() {
  const jobs = await downloadManager.list();
  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CreateDownloadInput> & {
      previewOnly?: boolean;
    };

    if (!body.infoHash || !body.mediaName || !body.mediaType) {
      return NextResponse.json(
        { error: "infoHash, mediaName, mediaType required" },
        { status: 400 },
      );
    }

    const input: CreateDownloadInput = {
      infoHash: body.infoHash,
      fileIdx: body.fileIdx ?? null,
      mediaName: body.mediaName,
      mediaType: body.mediaType as MediaType,
      imdbId: body.imdbId ?? null,
      year: body.year || "",
      season: body.season ?? null,
      episode: body.episode ?? null,
      episodeTitle: body.episodeTitle ?? null,
      episodeTitles: body.episodeTitles ?? null,
      quality: body.quality || "Unknown",
      extension: body.extension || "mkv",
      customFileName: body.customFileName ?? null,
      useAutoName: body.useAutoName !== false,
    };

    if (body.previewOnly) {
      const paths = buildJellyfinPaths({
        mediaName: input.mediaName,
        year: input.year,
        mediaType: input.mediaType,
        season: input.season,
        episode: input.episode,
        episodeTitle: input.episodeTitle,
        quality: input.quality,
        extension: input.extension || "mkv",
        customFileName: input.customFileName,
        useAutoName: input.useAutoName,
      });
      return NextResponse.json(paths);
    }

    const job = await downloadManager.enqueue(input);
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
