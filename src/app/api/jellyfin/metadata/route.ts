import { NextResponse } from "next/server";
import { scanLibrary } from "@/lib/library";
import {
  buildPathMatcher,
  isJellyfinConfigured,
  listIndexedFiles,
  triggerLibraryScan,
} from "@/lib/jellyfin";
import { getSettings } from "@/lib/settings";

export async function POST() {
  const settings = await getSettings();
  if (!isJellyfinConfigured(settings)) {
    return NextResponse.json(
      {
        error:
          "Jellyfin is not configured. Add the server URL and API key in Settings.",
      },
      { status: 400 },
    );
  }

  let index;
  let library;
  try {
    [library, index] = await Promise.all([
      scanLibrary({ force: true }),
      listIndexedFiles(settings),
    ]);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not reach Jellyfin",
      },
      { status: 502 },
    );
  }

  if (index.totalReported > 0 && index.entries.length === 0) {
    return NextResponse.json(
      {
        error: `Jellyfin reported ${index.totalReported} items but none expose file paths — cannot verify. Check that the API key has full access.`,
      },
      { status: 502 },
    );
  }

  const matcher = buildPathMatcher(index);

  const missingMovies = library.movies.filter(
    (m) => !m.files.some((f) => matcher.matches(f)),
  );
  const missingShows = library.shows.filter(
    (s) => !s.episodes.some((e) => matcher.matches(e.path)),
  );

  const totalItems = library.movies.length + library.shows.length;
  const missingCount = missingMovies.length + missingShows.length;

  let scanTriggered = false;
  let scanError: string | null = null;
  if (missingCount > 0) {
    try {
      await triggerLibraryScan(settings);
      scanTriggered = true;
    } catch (err) {
      scanError =
        err instanceof Error ? err.message : "Library scan request failed";
    }
  }

  const summary =
    missingCount === 0
      ? `All ${totalItems} item${totalItems === 1 ? "" : "s"} are already indexed on Jellyfin.`
      : `${missingCount} of ${totalItems} item${totalItems === 1 ? "" : "s"} not found on Jellyfin — ${scanTriggered ? "library scan requested." : "scan could not be started."}`;

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    totalItems,
    indexedItems: totalItems - missingCount,
    scanTriggered,
    scanError,
    summary,
    missingTotal: missingCount,
    missing: [
      ...missingMovies.map((m) => ({
        type: "movie" as const,
        name: m.name,
        year: m.year,
      })),
      ...missingShows.map((s) => ({
        type: "series" as const,
        name: s.name,
        year: null,
      })),
    ].slice(0, 50),
  });
}
