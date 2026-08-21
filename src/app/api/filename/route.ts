import { NextResponse } from "next/server";
import path from "path";
import { buildJellyfinPaths } from "@/lib/naming";
import { getSettings, libraryRootFor } from "@/lib/settings";
import type { MediaType } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json();
  const mediaType = ((body.mediaType as MediaType) || "movie") as MediaType;
  const paths = buildJellyfinPaths({
    mediaName: String(body.mediaName || ""),
    year: String(body.year || ""),
    mediaType,
    season: body.season ?? null,
    episode: body.episode ?? null,
    episodeTitle: body.episodeTitle ?? null,
    quality: String(body.quality || "Unknown"),
    extension: String(body.extension || "mkv"),
    customFileName: body.customFileName ?? null,
    useAutoName: body.useAutoName !== false,
  });
  const settings = await getSettings();
  const root = libraryRootFor(settings, mediaType);
  return NextResponse.json({
    fileName: paths.fileName,
    relativePath: paths.relativePath,
    relativeDir: paths.relativeDir,
    libraryRoot: root,
    absolutePath: path.join(root, paths.relativePath),
  });
}
