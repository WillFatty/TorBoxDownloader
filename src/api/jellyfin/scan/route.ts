import { isJellyfinConfigured, triggerLibraryScan } from "@/lib/jellyfin";
import { getSettings } from "@/lib/settings";

export async function POST() {
  const settings = await getSettings();
  if (!isJellyfinConfigured(settings)) {
    return Response.json(
      {
        error:
          "Jellyfin is not configured. Add the server URL and API key in Settings.",
      },
      { status: 400 },
    );
  }

  try {
    await triggerLibraryScan(settings);
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Library scan request failed",
      },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
