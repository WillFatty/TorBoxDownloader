import { promises as fs } from "fs";
import path from "path";
import type { AppSettings } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = process.env.SETTINGS_PATH
  ? path.resolve(process.env.SETTINGS_PATH)
  : path.join(DATA_DIR, "settings.json");

const defaults = (): AppSettings => ({
  torboxApiKey: process.env.TORBOX_API_KEY?.trim() ?? "",
  cometUrl: (process.env.COMET_URL?.trim() || "https://comet.elfhosted.com").replace(
    /\/$/,
    "",
  ),
  moviesPath:
    process.env.MOVIES_PATH?.trim() ||
    (process.env.DOWNLOAD_PATH?.trim()
      ? path.join(process.env.DOWNLOAD_PATH.trim(), "Movies")
      : path.join(path.sep, "raid", "Jellyfin", "Movies")),
  tvShowsPath:
    process.env.TV_SHOWS_PATH?.trim() ||
    (process.env.DOWNLOAD_PATH?.trim()
      ? path.join(process.env.DOWNLOAD_PATH.trim(), "TV-Shows")
      : path.join(path.sep, "raid", "Jellyfin", "TV-Shows")),
  jellyfinUrl: (process.env.JELLYFIN_URL?.trim() || "").replace(/\/$/, ""),
  jellyfinApiKey: process.env.JELLYFIN_API_KEY?.trim() ?? "",
});

async function ensureDataDir() {
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
}

function migratePaths(saved: Partial<AppSettings> & { downloadPath?: string }): {
  moviesPath: string;
  tvShowsPath: string;
} {
  const base = defaults();
  const legacy = saved.downloadPath?.trim();

  let moviesPath = saved.moviesPath?.trim() || "";
  let tvShowsPath = saved.tvShowsPath?.trim() || "";

  if (legacy) {
    const baseName = path.basename(legacy).toLowerCase();
    // If legacy root already IS Movies or TV-Shows, don't nest again
    if (!moviesPath) {
      moviesPath =
        baseName === "movies" ? legacy : path.join(legacy, "Movies");
    }
    if (!tvShowsPath) {
      tvShowsPath =
        baseName === "tv-shows" || baseName === "tv shows"
          ? legacy
          : path.join(legacy, "TV-Shows");
    }
  }

  // Collapse accidental ...\TV-Shows\TV-Shows
  tvShowsPath = collapseDupLeaf(tvShowsPath || base.tvShowsPath, "TV-Shows");
  moviesPath = collapseDupLeaf(moviesPath || base.moviesPath, "Movies");

  return { moviesPath, tvShowsPath };
}

function collapseDupLeaf(p: string, leaf: string): string {
  const norm = path.normalize(p);
  const parts = norm.split(/[/\\]/).filter(Boolean);
  while (
    parts.length >= 2 &&
    parts[parts.length - 1].toLowerCase() === leaf.toLowerCase() &&
    parts[parts.length - 2].toLowerCase() === leaf.toLowerCase()
  ) {
    parts.pop();
  }
  // Windows drive restore
  if (/^[a-zA-Z]:$/.test(parts[0] || "")) {
    return parts[0] + "\\" + parts.slice(1).join("\\");
  }
  if (norm.startsWith("\\\\")) {
    return "\\\\" + parts.join("\\");
  }
  // Unix absolute — leading "/" is lost by filter(Boolean)
  if (norm.startsWith("/")) {
    return "/" + parts.join("/");
  }
  return parts.join(path.sep);
}

export async function getSettings(): Promise<AppSettings> {
  const base = defaults();
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const saved = JSON.parse(raw) as Partial<AppSettings> & {
      downloadPath?: string;
    };
    const paths = migratePaths(saved);
    return {
      torboxApiKey: saved.torboxApiKey?.trim() || base.torboxApiKey,
      cometUrl: (saved.cometUrl?.trim() || base.cometUrl).replace(/\/$/, ""),
      moviesPath: paths.moviesPath,
      tvShowsPath: paths.tvShowsPath,
      jellyfinUrl: (saved.jellyfinUrl?.trim() || base.jellyfinUrl).replace(
        /\/$/,
        "",
      ),
      jellyfinApiKey: saved.jellyfinApiKey?.trim() || base.jellyfinApiKey,
    };
  } catch {
    return base;
  }
}

export async function saveSettings(
  partial: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = {
    torboxApiKey:
      partial.torboxApiKey !== undefined
        ? partial.torboxApiKey.trim()
        : current.torboxApiKey,
    cometUrl:
      partial.cometUrl !== undefined
        ? partial.cometUrl.trim().replace(/\/$/, "")
        : current.cometUrl,
    moviesPath:
      partial.moviesPath !== undefined
        ? partial.moviesPath.trim()
        : current.moviesPath,
    tvShowsPath:
      partial.tvShowsPath !== undefined
        ? partial.tvShowsPath.trim()
        : current.tvShowsPath,
    jellyfinUrl:
      partial.jellyfinUrl !== undefined
        ? partial.jellyfinUrl.trim().replace(/\/$/, "")
        : current.jellyfinUrl,
    jellyfinApiKey:
      partial.jellyfinApiKey !== undefined
        ? partial.jellyfinApiKey.trim()
        : current.jellyfinApiKey,
  };
  await ensureDataDir();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function libraryRootFor(
  settings: AppSettings,
  mediaType: "movie" | "series",
): string {
  return mediaType === "series" ? settings.tvShowsPath : settings.moviesPath;
}

export function maskSettings(settings: AppSettings) {
  const key = settings.torboxApiKey;
  const jfKey = settings.jellyfinApiKey;
  return {
    ...settings,
    torboxApiKey: key
      ? `${key.slice(0, 4)}${"•".repeat(Math.max(0, key.length - 8))}${key.slice(-4)}`
      : "",
    hasTorboxApiKey: Boolean(key),
    jellyfinApiKey: jfKey
      ? `${jfKey.slice(0, 4)}${"•".repeat(Math.max(0, jfKey.length - 8))}${jfKey.slice(-4)}`
      : "",
    hasJellyfinApiKey: Boolean(jfKey),
  };
}
