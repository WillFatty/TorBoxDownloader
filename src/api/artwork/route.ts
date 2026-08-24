
import { resolveArtwork, type ArtworkRequest } from "@/lib/artwork";
import {
  validateLibraryItem,
  type NamingIssue,
} from "@/lib/library-naming";

const MAX_ITEMS = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      items?: Array<{
        key?: unknown;
        type?: unknown;
        name?: unknown;
        year?: unknown;
        folderName?: unknown;
        files?: unknown;
        episodes?: unknown;
      }>;
    };

    const items: ArtworkRequest[] = [];
    for (const entry of (body.items || []).slice(0, MAX_ITEMS)) {
      const key = typeof entry.key === "string" ? entry.key : "";
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (!key || !name) continue;

      const item: ArtworkRequest = {
        key,
        name,
        type: entry.type === "series" ? "series" : "movie",
        year: typeof entry.year === "string" ? entry.year : null,
        folderName:
          typeof entry.folderName === "string" ? entry.folderName.trim() : name,
      };

      if (Array.isArray(entry.files)) {
        item.files = entry.files.filter(
          (f): f is string => typeof f === "string" && f.length > 0,
        );
      }

      if (Array.isArray(entry.episodes)) {
        item.episodes = entry.episodes
          .map((ep) => {
            if (!ep || typeof ep !== "object") return null;
            const row = ep as Record<string, unknown>;
            const season = Number(row.season);
            const episode = Number(row.episode);
            const fileName =
              typeof row.fileName === "string" ? row.fileName : "";
            if (!Number.isFinite(season) || !Number.isFinite(episode) || !fileName) {
              return null;
            }
            return { season, episode, fileName };
          })
          .filter((ep): ep is NonNullable<typeof ep> => Boolean(ep));
      }

      items.push(item);
    }

    const resolved = await resolveArtwork(items);
    const artwork: Record<
      string,
      {
        poster: string | null;
        imdbId: string | null;
        canonicalName: string | null;
        canonicalYear: string | null;
        namingIssues: NamingIssue[];
      }
    > = {};

    for (const item of items) {
      const hit = resolved[item.key];
      if (!hit) continue;

      const canonical =
        hit.canonicalName != null
          ? { name: hit.canonicalName, year: hit.canonicalYear }
          : null;

      const namingIssues = validateLibraryItem(
        item.type,
        {
          folderName: item.folderName || item.name,
          parsedName: item.name,
          parsedYear: item.year ?? null,
          files: item.files,
          episodes: item.episodes,
        },
        canonical,
      );

      artwork[item.key] = {
        ...hit,
        namingIssues,
      };
    }

    return Response.json({ artwork });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Artwork lookup failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
