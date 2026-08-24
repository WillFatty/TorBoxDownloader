
import { getMediaMeta } from "@/lib/cinemeta";
import type { MediaType } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim() || "";
  const type = searchParams.get("type") as MediaType | null;

  if (!id || (type !== "movie" && type !== "series")) {
    return Response.json({ error: "id and type required" }, { status: 400 });
  }

  try {
    const meta = await getMediaMeta(type, id);
    if (!meta) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Meta fetch failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
