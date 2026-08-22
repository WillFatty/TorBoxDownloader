import { NextResponse } from "next/server";
import { resolveArtwork, type ArtworkRequest } from "@/lib/artwork";

const MAX_ITEMS = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      items?: Array<{
        key?: unknown;
        type?: unknown;
        name?: unknown;
        year?: unknown;
      }>;
    };

    const items: ArtworkRequest[] = [];
    for (const entry of (body.items || []).slice(0, MAX_ITEMS)) {
      const key = typeof entry.key === "string" ? entry.key : "";
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (!key || !name) continue;
      items.push({
        key,
        name,
        type: entry.type === "series" ? "series" : "movie",
        year: typeof entry.year === "string" ? entry.year : null,
      });
    }

    const artwork = await resolveArtwork(items);
    return NextResponse.json({ artwork });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Artwork lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
