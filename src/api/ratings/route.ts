import { getMediaRatings } from "@/lib/ratings";
import { getSettings } from "@/lib/settings";
import type { MediaType } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim() || "";
  const type = searchParams.get("type") as MediaType | null;

  if (!id || (type !== "movie" && type !== "series")) {
    return Response.json({ error: "id and type required" }, { status: 400 });
  }

  try {
    const settings = await getSettings();
    const ratings = await getMediaRatings(type, id, settings.omdbApiKey);
    return Response.json({
      ratings,
      hasOmdbApiKey: Boolean(settings.omdbApiKey),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ratings fetch failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
