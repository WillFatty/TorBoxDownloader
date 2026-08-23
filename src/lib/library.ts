import { promises as fs } from "fs";
import path from "path";
import { getSettings } from "./settings";
import { parseEpisodeFromName } from "./episodes";

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|ts|mov)$/i;
const TEMP_SUFFIX = /\.(part|tb-bak|tmp)$/i;

export function isVideoFileName(name: string): boolean {
  if (name.startsWith(".")) return false;
  if (TEMP_SUFFIX.test(name)) return false;
  return VIDEO_EXT.test(name);
}

export interface LibraryMovie {
  name: string;
  year: string | null;
  folder: string;
  files: string[];
}

export interface LibraryEpisode {
  season: number;
  episode: number;
  fileName: string;
  path: string;
}

export interface LibraryShow {
  name: string;
  folder: string;
  seasons: number[];
  episodeCount: number;
  episodes: LibraryEpisode[];
}

export interface LibraryIndex {
  root: string;
  movies: LibraryMovie[];
  shows: LibraryShow[];
  scannedAt: string;
}

function parseMovieFolder(folderName: string): { name: string; year: string | null } {
  const m = folderName.match(/^(.*)\s*\((\d{4})\)\s*$/);
  if (m) return { name: m[1].trim(), year: m[2] };
  return { name: folderName.trim(), year: null };
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listVideoFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && isVideoFileName(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

async function scanShow(showRoot: string, showName: string): Promise<LibraryShow> {
  const seasonDirs = await listDirs(showRoot);
  const episodes: LibraryEpisode[] = [];
  const seasons = new Set<number>();

  for (const seasonDir of seasonDirs) {
    const seasonMatch = seasonDir.match(/season\s*(\d+)/i);
    const seasonNum = seasonMatch ? parseInt(seasonMatch[1], 10) : null;
    const seasonPath = path.join(showRoot, seasonDir);
    const files = await listVideoFiles(seasonPath);

    for (const file of files) {
      const parsed = parseEpisodeFromName(file);
      const season = parsed?.season ?? seasonNum ?? 0;
      const episode = parsed?.episode ?? 0;
      if (season > 0) seasons.add(season);
      episodes.push({
        season,
        episode,
        fileName: file,
        path: path.join(seasonPath, file),
      });
    }
  }

  // also videos directly in show root
  for (const file of await listVideoFiles(showRoot)) {
    const parsed = parseEpisodeFromName(file);
    if (!parsed) continue;
    seasons.add(parsed.season);
    episodes.push({
      season: parsed.season,
      episode: parsed.episode,
      fileName: file,
      path: path.join(showRoot, file),
    });
  }

  episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);

  return {
    name: showName,
    folder: showRoot,
    seasons: [...seasons].sort((a, b) => a - b),
    episodeCount: episodes.length,
    episodes,
  };
}

const SCAN_CACHE_FILE = path.join(process.cwd(), "data", "library-cache.json");
const SCAN_FRESH_MS = 30_000;

let cachedIndex: LibraryIndex | null = null;
let cacheLoaded = false;
let refreshing: Promise<void> | null = null;

async function loadScanCache(): Promise<void> {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = await fs.readFile(SCAN_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as LibraryIndex | null;
    if (
      parsed &&
      Array.isArray(parsed.movies) &&
      Array.isArray(parsed.shows)
    ) {
      cachedIndex = parsed;
    }
  } catch {
    cachedIndex = null;
  }
}

function saveScanCache(): void {
  if (!cachedIndex) return;
  void fs
    .writeFile(SCAN_CACHE_FILE, JSON.stringify(cachedIndex), "utf8")
    .catch(() => undefined);
}

async function performScan(): Promise<LibraryIndex> {
  const settings = await getSettings();
  const moviesRoot = settings.moviesPath;
  const showsRoot = settings.tvShowsPath;

  const movieFolders = await listDirs(moviesRoot);
  const movies: LibraryMovie[] = [];
  for (const folder of movieFolders.sort((a, b) => a.localeCompare(b))) {
    const folderPath = path.join(moviesRoot, folder);
    const files = await listVideoFiles(folderPath);
    const { name, year } = parseMovieFolder(folder);
    movies.push({ name, year, folder: folderPath, files });
  }

  const showFolders = await listDirs(showsRoot);
  const shows: LibraryShow[] = [];
  for (const folder of showFolders.sort((a, b) => a.localeCompare(b))) {
    shows.push(await scanShow(path.join(showsRoot, folder), folder));
  }

  return {
    root: `${moviesRoot} | ${showsRoot}`,
    movies,
    shows,
    scannedAt: new Date().toISOString(),
  };
}

export async function scanLibrary(
  options?: { force?: boolean },
): Promise<LibraryIndex> {
  await loadScanCache();
  const force = options?.force === true;

  if (!cachedIndex || force) {
    cachedIndex = await performScan();
    saveScanCache();
    return cachedIndex;
  }

  // Serve the last known index immediately and refresh in the background so
  // opening the library never waits on a full disk walk (e.g. while remuxing
  // saturates I/O).
  const age = Date.now() - Date.parse(cachedIndex.scannedAt);
  if (age > SCAN_FRESH_MS && !refreshing) {
    refreshing = performScan()
      .then((index) => {
        cachedIndex = index;
        saveScanCache();
      })
      .catch(() => undefined)
      .finally(() => {
        refreshing = null;
      });
  }

  return cachedIndex;
}

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function libraryHasMovie(
  lib: LibraryIndex,
  name: string,
  year?: string,
): LibraryMovie | null {
  const target = normalizeTitle(name);
  return (
    lib.movies.find((m) => {
      const sameName = normalizeTitle(m.name) === target;
      if (!sameName) return false;
      if (year && m.year && m.year !== year) return false;
      return m.files.length > 0;
    }) || null
  );
}

export function libraryHasShow(
  lib: LibraryIndex,
  name: string,
): LibraryShow | null {
  const target = normalizeTitle(name);
  return lib.shows.find((s) => normalizeTitle(s.name) === target) || null;
}

export function libraryHasEpisode(
  show: LibraryShow,
  season: number,
  episode: number,
): boolean {
  return show.episodes.some((e) => e.season === season && e.episode === episode);
}
