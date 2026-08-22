import { promises as fs } from "fs";
import path from "path";
import { parseEpisodeFromName } from "./episodes";
import { expectedMovieFolder } from "./library-naming";
import { buildJellyfinPaths, sanitizeFileName } from "./naming";
import { getSettings, libraryRootFor } from "./settings";
import type { MediaType } from "./types";

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|ts|mov)$/i;
const RESOLUTION = /\b(2160p|1080p|720p|480p|4k)\b/i;

export interface FixRequest {
  type: MediaType;
  folder: string;
  issueCode: string;
  file?: string;
  canonicalName: string;
  canonicalYear?: string | null;
  episodeTitles?: Record<string, string>;
}

export interface FixChange {
  from: string;
  to: string;
}

export interface FixResult {
  ok: true;
  newFolder: string;
  changes: FixChange[];
}

const MOVIE_FOLDER_CODES = new Set([
  "missing_year",
  "title_mismatch",
  "year_mismatch",
  "folder_format",
]);

const SHOW_FOLDER_CODES = new Set(["title_mismatch", "folder_format"]);

const EPISODE_FILE_CODES = new Set(["episode_code", "file_title"]);

export function isFixableIssueCode(code: string): boolean {
  return (
    MOVIE_FOLDER_CODES.has(code) ||
    code === "file_name" ||
    SHOW_FOLDER_CODES.has(code) ||
    EPISODE_FILE_CODES.has(code)
  );
}

export interface FixStep {
  issueCode: string;
  file?: string;
}

/** Order folder fixes first, then one fix per file (deduped). */
export function planFixSteps(
  issues: FixStep[],
  type: MediaType,
): FixStep[] {
  const folderCodes =
    type === "movie" ? MOVIE_FOLDER_CODES : SHOW_FOLDER_CODES;
  const steps: FixStep[] = [];
  const seenFiles = new Set<string>();
  let folderPlanned = false;

  for (const issue of issues) {
    if (!isFixableIssueCode(issue.issueCode)) continue;

    if (folderCodes.has(issue.issueCode)) {
      if (!folderPlanned) {
        steps.push({ issueCode: issue.issueCode });
        folderPlanned = true;
      }
      continue;
    }

    if (!issue.file) continue;
    if (seenFiles.has(issue.file)) continue;
    seenFiles.add(issue.file);

    steps.push({
      issueCode: type === "series" ? "episode_code" : "file_name",
      file: issue.file,
    });
  }

  return steps;
}

export interface FixAllRequest extends Omit<FixRequest, "issueCode" | "file"> {
  issues: FixStep[];
}

export async function applyAllNamingFixes(
  input: FixAllRequest,
): Promise<FixResult> {
  const steps = planFixSteps(input.issues, input.type);
  if (!steps.length) {
    throw new Error("No fixable naming issues");
  }

  let folder = path.resolve(input.folder);
  const settings = await getSettings();
  const root = libraryRootFor(settings, input.type);
  assertUnderRoot(folder, root);

  const allChanges: FixChange[] = [];

  for (const step of steps) {
    const result = await applyNamingFix({
      type: input.type,
      folder,
      issueCode: step.issueCode,
      file: step.file,
      canonicalName: input.canonicalName,
      canonicalYear: input.canonicalYear,
      episodeTitles: input.episodeTitles,
    });
    folder = result.newFolder;
    allChanges.push(...result.changes);
  }

  return { ok: true, newFolder: folder, changes: allChanges };
}

function assertUnderRoot(target: string, root: string): void {
  const resolved = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error("Path is outside the library root");
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Same path on disk when casing is ignored (common on SMB / macOS volumes). */
function isCaseOnlyRename(from: string, to: string): boolean {
  return (
    from !== to &&
    path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()
  );
}

async function renamePath(from: string, to: string): Promise<FixChange> {
  if (from === to) {
    return { from, to };
  }

  // Case-only changes must go through a temp name — direct rename fails when
  // the filesystem treats "DeadPool" and "Deadpool" as the same path.
  if (isCaseOnlyRename(from, to)) {
    const temp = path.join(
      path.dirname(to),
      `.tb-rename-${process.pid}-${Date.now()}-${path.basename(to)}`,
    );
    await fs.rename(from, temp);
    await fs.rename(temp, to);
    return { from, to };
  }

  if (await pathExists(to)) {
    throw new Error(`Target already exists: ${path.basename(to)}`);
  }
  await fs.rename(from, to);
  return { from, to };
}

function extractMovieQuality(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/i, "");
  const parts = stem.split(" - ");
  if (parts.length > 1) {
    const tail = parts.slice(1).join(" - ").trim();
    if (tail) return tail;
  }
  const hit = fileName.match(RESOLUTION);
  if (hit) return hit[1].toUpperCase().replace(/^4K$/i, "2160P");
  return "Unknown";
}

async function listVideoFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && VIDEO_EXT.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

async function findEpisodeFile(
  showRoot: string,
  fileName: string,
): Promise<string | null> {
  const direct = path.join(showRoot, fileName);
  if (await pathExists(direct)) return direct;

  const seasonDirs = await fs.readdir(showRoot, { withFileTypes: true });
  for (const entry of seasonDirs) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(showRoot, entry.name, fileName);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function fixMovieFolder(
  folder: string,
  moviesRoot: string,
  canonicalName: string,
  canonicalYear: string | null | undefined,
): Promise<FixResult> {
  if (!canonicalYear) {
    throw new Error("Cannot rename movie folder without a release year");
  }

  const expected = expectedMovieFolder(canonicalName, canonicalYear);
  const parent = path.dirname(folder);
  assertUnderRoot(folder, moviesRoot);
  assertUnderRoot(parent, moviesRoot);

  const nextFolder = path.join(parent, expected);
  const change = await renamePath(folder, nextFolder);
  return {
    ok: true,
    newFolder: nextFolder,
    changes: change.from === change.to ? [] : [change],
  };
}

async function fixMovieFile(
  folder: string,
  moviesRoot: string,
  fileName: string,
  canonicalName: string,
  canonicalYear: string | null | undefined,
): Promise<FixResult> {
  if (!canonicalYear) {
    throw new Error("Cannot rename movie file without a release year");
  }

  assertUnderRoot(folder, moviesRoot);
  const expectedFolder = expectedMovieFolder(canonicalName, canonicalYear);
  const from = path.join(folder, fileName);
  assertUnderRoot(from, moviesRoot);

  if (!(await pathExists(from))) {
    throw new Error(`File not found: ${fileName}`);
  }

  const ext = path.extname(fileName).replace(/^\./, "") || "mkv";
  const quality = extractMovieQuality(fileName);
  const nextName = buildJellyfinPaths({
    mediaName: canonicalName,
    year: canonicalYear,
    mediaType: "movie",
    quality,
    extension: ext,
    useAutoName: true,
  }).fileName;

  const to = path.join(folder, nextName);
  const change = await renamePath(from, to);
  return {
    ok: true,
    newFolder: folder,
    changes: change.from === change.to ? [] : [change],
  };
}

async function fixShowFolder(
  folder: string,
  showsRoot: string,
  canonicalName: string,
): Promise<FixResult> {
  assertUnderRoot(folder, showsRoot);
  const parent = path.dirname(folder);
  assertUnderRoot(parent, showsRoot);

  const expected = sanitizeFileName(canonicalName);
  const nextFolder = path.join(parent, expected);
  const change = await renamePath(folder, nextFolder);
  return {
    ok: true,
    newFolder: nextFolder,
    changes: change.from === change.to ? [] : [change],
  };
}

async function fixEpisodeFile(
  folder: string,
  showsRoot: string,
  fileName: string,
  canonicalName: string,
  episodeTitles?: Record<string, string>,
): Promise<FixResult> {
  assertUnderRoot(folder, showsRoot);
  const from = await findEpisodeFile(folder, fileName);
  if (!from) {
    throw new Error(`Episode file not found: ${fileName}`);
  }
  assertUnderRoot(from, showsRoot);

  const parsed = parseEpisodeFromName(fileName);
  if (!parsed) {
    throw new Error(`Could not parse season/episode from ${fileName}`);
  }

  const titleKey = `${parsed.season}:${parsed.episode}`;
  const episodeTitle = episodeTitles?.[titleKey] || null;
  const ext = path.extname(fileName).replace(/^\./, "") || "mkv";

  const nextName = buildJellyfinPaths({
    mediaName: canonicalName,
    year: "",
    mediaType: "series",
    season: parsed.season,
    episode: parsed.episode,
    episodeTitle,
    quality: "Unknown",
    extension: ext,
    useAutoName: true,
  }).fileName;

  const to = path.join(path.dirname(from), nextName);
  const change = await renamePath(from, to);
  return {
    ok: true,
    newFolder: folder,
    changes: change.from === change.to ? [] : [change],
  };
}

export async function applyNamingFix(input: FixRequest): Promise<FixResult> {
  const settings = await getSettings();
  const root = libraryRootFor(settings, input.type);
  const folder = path.resolve(input.folder);

  assertUnderRoot(folder, root);

  if (!isFixableIssueCode(input.issueCode)) {
    throw new Error("This issue cannot be fixed automatically");
  }

  if (input.type === "movie") {
    if (MOVIE_FOLDER_CODES.has(input.issueCode)) {
      return fixMovieFolder(
        folder,
        root,
        input.canonicalName,
        input.canonicalYear,
      );
    }
    if (input.issueCode === "file_name") {
      if (!input.file) throw new Error("Missing file name");
      return fixMovieFile(
        folder,
        root,
        input.file,
        input.canonicalName,
        input.canonicalYear,
      );
    }
  }

  if (input.type === "series") {
    if (SHOW_FOLDER_CODES.has(input.issueCode)) {
      return fixShowFolder(folder, root, input.canonicalName);
    }
    if (EPISODE_FILE_CODES.has(input.issueCode)) {
      if (!input.file) throw new Error("Missing file name");
      return fixEpisodeFile(
        folder,
        root,
        input.file,
        input.canonicalName,
        input.episodeTitles,
      );
    }
  }

  throw new Error("Unsupported fix for this item");
}

/** Used by tests and dry-run previews. */
export async function listMovieFiles(folder: string): Promise<string[]> {
  return listVideoFiles(folder);
}
