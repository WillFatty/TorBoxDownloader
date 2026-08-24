
import { searchMedia } from "@/lib/cinemeta";
import type { MediaType } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || "";
  const type = searchParams.get("type") as MediaType | null;

  if (!q) {
    return Response.json({ results: [] });
  }

  try {
    const results = await searchMedia(
      q,
      type === "movie" || type === "series" ? type : undefined,
    );
    return Response.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
