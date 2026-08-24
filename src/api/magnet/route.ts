
import { searchMedia } from "@/lib/cinemeta";
import { extractQuality } from "@/lib/comet";
import { detectPackHint } from "@/lib/episodes";
import {
  bestSearchMatch,
  cleanTorrentTitle,
  displayNameFromMagnet,
  extractInfoHash,
} from "@/lib/magnet";

export async function POST(request: Request) {
  let magnet = "";
  try {
    const body = (await request.json()) as { magnet?: unknown };
    if (typeof body.magnet === "string") magnet = body.magnet;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const infoHash = extractInfoHash(magnet);
  if (!infoHash) {
    return Response.json(
      { error: "No valid info hash found — paste a magnet:?xt=urn:btih:… link or a bare hash." },
      { status: 400 },
    );
  }

  const displayName = displayNameFromMagnet(magnet);
  if (!displayName) {
    return Response.json(
      {
        error:
          "Magnet has no display name (&dn=). Paste one with a name, or search for the title manually.",
      },
      { status: 400 },
    );
  }

  const cleaned = cleanTorrentTitle(displayName);
  if (!cleaned.title) {
    return Response.json(
      {
        error:
          "Couldn't extract a title from the magnet name — try searching for it manually.",
      },
      { status: 400 },
    );
  }

  let results;
  try {
    results = await searchMedia(
      cleaned.title,
      cleaned.season != null ? "series" : undefined,
    );
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Title lookup failed",
      },
      { status: 502 },
    );
  }

  const match = bestSearchMatch(cleaned, results);
  if (!match) {
    return Response.json(
      {
        error: `Couldn't identify "${cleaned.title}" on Cinemeta — search for it manually and download any stream.`,
      },
      { status: 404 },
    );
  }

  return Response.json({
    infoHash,
    displayName,
    cleanTitle: cleaned.title,
    quality: extractQuality(displayName),
    packLabel: detectPackHint(displayName).label,
    season: cleaned.season,
    episode: cleaned.episode,
    match: {
      type: match.type,
      imdbId: match.imdbId,
      name: match.name,
      year: match.year,
      poster: match.poster,
    },
  });
}
