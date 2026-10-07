import {
  isJellyfinConfigured,
  JellyfinError,
  triggerLibraryScan,
} from "@/lib/jellyfin";
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
    const message =
      err instanceof Error ? err.message : "Library scan request failed";
    const status =
      err instanceof JellyfinError && err.status === 401
        ? 401
        : err instanceof JellyfinError && err.status === 403
          ? 403
          : err instanceof JellyfinError && err.status === 504
            ? 504
            : 502;
    return Response.json({ error: message }, { status });
  }

  return Response.json({ ok: true });
}
