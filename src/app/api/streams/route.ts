import { NextResponse } from "next/server";
import { fetchCometStreams } from "@/lib/comet";
import { getSettings } from "@/lib/settings";
import { checkCached, detectCachedHint } from "@/lib/torbox";
import type { MediaType } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as MediaType | null;
  const id = searchParams.get("id")?.trim() || "";
  const season = searchParams.get("season");
  const episode = searchParams.get("episode");

  if (!id || (type !== "movie" && type !== "series")) {
    return NextResponse.json({ error: "type and id required" }, { status: 400 });
  }

  let mediaId = id;
  if (type === "series") {
    if (!season || !episode) {
      return NextResponse.json(
        { error: "season and episode required for series" },
        { status: 400 },
      );
    }
    mediaId = `${id}:${season}:${episode}`;
  }

  try {
    const settings = await getSettings();
    const streams = await fetchCometStreams({
      cometUrl: settings.cometUrl,
      type,
      mediaId,
    });

    // Seed from Comet title hints (works even without our TorBox key)
    for (const s of streams) {
      const hint = detectCachedHint(s.name, s.title);
      if (hint != null) s.cached = hint;
    }

    let cacheError: string | null = null;
    let cacheChecked = false;

    if (settings.torboxApiKey && streams.length) {
      const hashes = streams.map((s) => s.infoHash);
      try {
        const cached = await checkCached(settings.torboxApiKey, hashes);
        cacheChecked = true;
        for (const s of streams) {
          // TorBox API is source of truth when check succeeds
          s.cached = cached[s.infoHash] === true;
        }
        streams.sort((a, b) => Number(b.cached) - Number(a.cached));
      } catch (err) {
        cacheError =
          err instanceof Error ? err.message : "TorBox cache check failed";
      }
    }

    return NextResponse.json({
      streams,
      mediaId,
      cacheChecked,
      cacheError,
      cachedCount: streams.filter((s) => s.cached).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
