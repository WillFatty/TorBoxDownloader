import { NextResponse } from "next/server";
import { getSettings, maskSettings, saveSettings } from "@/lib/settings";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ settings: maskSettings(settings) });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      torboxApiKey?: string;
      cometUrl?: string;
      moviesPath?: string;
      tvShowsPath?: string;
      jellyfinUrl?: string;
      jellyfinApiKey?: string;
    };

    const partial: {
      torboxApiKey?: string;
      cometUrl?: string;
      moviesPath?: string;
      tvShowsPath?: string;
      jellyfinUrl?: string;
      jellyfinApiKey?: string;
    } = {};

    if (typeof body.cometUrl === "string") partial.cometUrl = body.cometUrl;
    if (typeof body.moviesPath === "string") partial.moviesPath = body.moviesPath;
    if (typeof body.tvShowsPath === "string") {
      partial.tvShowsPath = body.tvShowsPath;
    }
    if (typeof body.jellyfinUrl === "string") {
      partial.jellyfinUrl = body.jellyfinUrl;
    }
    if (
      typeof body.torboxApiKey === "string" &&
      body.torboxApiKey.trim() &&
      !body.torboxApiKey.includes("•")
    ) {
      partial.torboxApiKey = body.torboxApiKey;
    }
    if (
      typeof body.jellyfinApiKey === "string" &&
      body.jellyfinApiKey.trim() &&
      !body.jellyfinApiKey.includes("•")
    ) {
      partial.jellyfinApiKey = body.jellyfinApiKey;
    }

    const settings = await saveSettings(partial);
    return NextResponse.json({ settings: maskSettings(settings) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
