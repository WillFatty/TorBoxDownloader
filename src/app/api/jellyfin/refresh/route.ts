import { NextResponse } from "next/server";
import {
  findJellyfinItemIdByPaths,
  isJellyfinConfigured,
  refreshJellyfinItem,
} from "@/lib/jellyfin";
import { getSettings } from "@/lib/settings";

export async function POST(request: Request) {
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

  let body: { type?: unknown; paths?: unknown };
  try {
    body = (await request.json()) as { type?: unknown; paths?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const type =
    body.type === "series" ? "series" : body.type === "movie" ? "movie" : null;
  const paths = Array.isArray(body.paths)
    ? body.paths.filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      )
    : [];

  if (!type || !paths.length) {
    return NextResponse.json(
      { error: "type and paths are required" },
      { status: 400 },
    );
  }

  let itemId: string | null;
  try {
    itemId = await findJellyfinItemIdByPaths(settings, type, paths);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach Jellyfin" },
      { status: 502 },
    );
  }

  if (!itemId) {
    return NextResponse.json(
      {
        error:
          "This item isn't indexed on Jellyfin yet — run a library scan first.",
      },
      { status: 404 },
    );
  }

  try {
    await refreshJellyfinItem(settings, itemId);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Metadata refresh failed",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
