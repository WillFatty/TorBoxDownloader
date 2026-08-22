import path from "path";
import { parseEpisodeFromName } from "./episodes";
import { normalizeTitle } from "./library";
import { sanitizeFileName } from "./naming";
import type { MediaType } from "./types";

export interface NamingIssue {
  scope: "folder" | "file";
  severity: "error" | "warn";
  code: string;
  message: string;
  expected?: string;
  actual?: string;
  file?: string;
}

export interface CanonicalMedia {
  name: string;
  year?: string | null;
}

function compactTitle(s: string): string {
  return normalizeTitle(s).replace(/\s+/g, "");
}

export function titlesMatch(a: string, b: string): boolean {
  if (normalizeTitle(a) === normalizeTitle(b)) return true;
  return compactTitle(a) === compactTitle(b);
}

export function expectedMovieFolder(name: string, year: string): string {
  return sanitizeFileName(`${name} (${year})`);
}

export function checkMovieNaming(input: {
  folderName: string;
  parsedName: string;
  parsedYear: string | null;
  files: string[];
  canonical: CanonicalMedia | null;
}): NamingIssue[] {
  const issues: NamingIssue[] = [];
  const { folderName, parsedName, parsedYear, files, canonical } = input;

  if (!parsedYear) {
    issues.push({
      scope: "folder",
      severity: "error",
      code: "missing_year",
      message: "Movie folder is missing the release year in parentheses.",
      expected: canonical?.year
        ? expectedMovieFolder(canonical.name, canonical.year)
        : "Title (YYYY)",
      actual: folderName,
    });
  }

  if (!canonical) {
    issues.push({
      scope: "folder",
      severity: "warn",
      code: "unmatched",
      message: "Could not match this folder to a movie in Cinemeta.",
      actual: folderName,
    });
    return issues;
  }

  if (!titlesMatch(parsedName, canonical.name)) {
    issues.push({
      scope: "folder",
      severity: "error",
      code: "title_mismatch",
      message: "Folder title does not match the identified movie.",
      expected: canonical.name,
      actual: parsedName,
    });
  }

  if (parsedYear && canonical.year && parsedYear !== canonical.year) {
    issues.push({
      scope: "folder",
      severity: "error",
      code: "year_mismatch",
      message: "Folder year does not match the identified movie.",
      expected: canonical.year,
      actual: parsedYear,
    });
  }

  if (canonical.year) {
    const expectedFolder = expectedMovieFolder(canonical.name, canonical.year);
    if (sanitizeFileName(folderName) !== expectedFolder) {
      issues.push({
        scope: "folder",
        severity: "warn",
        code: "folder_format",
        message: "Folder name does not match the Jellyfin movie layout.",
        expected: expectedFolder,
        actual: folderName,
      });
    }
  }

  if (canonical.year) {
    const expectedFolder = expectedMovieFolder(canonical.name, canonical.year);
    for (const file of files) {
      const stem = file.replace(/\.[^.]+$/i, "");
      const okPrefix =
        stem === expectedFolder ||
        stem.startsWith(`${expectedFolder} -`) ||
        titlesMatch(
          stem.split(" - ")[0] || stem,
          expectedFolder.replace(/\s*\(\d{4}\)$/, "").trim(),
        );
      if (!okPrefix) {
        issues.push({
          scope: "file",
          severity: "warn",
          code: "file_name",
          message: "Movie file name does not follow Jellyfin naming.",
          expected: `${expectedFolder} - Quality.ext`,
          actual: file,
          file,
        });
      }
    }
  }

  return issues;
}

export function checkShowNaming(input: {
  folderName: string;
  episodes: Array<{ season: number; episode: number; fileName: string }>;
  canonical: CanonicalMedia | null;
}): NamingIssue[] {
  const issues: NamingIssue[] = [];
  const { folderName, episodes, canonical } = input;

  if (!canonical) {
    issues.push({
      scope: "folder",
      severity: "warn",
      code: "unmatched",
      message: "Could not match this folder to a TV show in Cinemeta.",
      actual: folderName,
    });
    return issues;
  }

  if (!titlesMatch(folderName, canonical.name)) {
    issues.push({
      scope: "folder",
      severity: "error",
      code: "title_mismatch",
      message: "Folder title does not match the identified show.",
      expected: canonical.name,
      actual: folderName,
    });
  }

  const expectedFolder = sanitizeFileName(canonical.name);
  if (sanitizeFileName(folderName) !== expectedFolder) {
    issues.push({
      scope: "folder",
      severity: "warn",
      code: "folder_format",
      message: "Folder name does not match the Jellyfin TV show layout.",
      expected: expectedFolder,
      actual: folderName,
    });
  }

  for (const ep of episodes) {
    const code = `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`;
    const parsed = parseEpisodeFromName(ep.fileName);
    const hasCode =
      parsed?.season === ep.season &&
      parsed?.episode === ep.episode &&
      ep.fileName.toUpperCase().includes(code);
    if (!hasCode) {
      issues.push({
        scope: "file",
        severity: "warn",
        code: "episode_code",
        message: `Episode file should include ${code}.`,
        expected: `${canonical.name} - ${code} - Episode Title.ext`,
        actual: ep.fileName,
        file: ep.fileName,
      });
    }

    const stem = ep.fileName.replace(/\.[^.]+$/i, "");
    const showPrefix = stem.split(" - ")[0] || stem;
    if (!titlesMatch(showPrefix, canonical.name)) {
      issues.push({
        scope: "file",
        severity: "warn",
        code: "file_title",
        message: "Episode file name does not start with the show title.",
        expected: `${canonical.name} - ${code} - …`,
        actual: ep.fileName,
        file: ep.fileName,
      });
    }
  }

  return issues;
}

export function folderLabelFromPath(folderPath: string): string {
  return path.basename(folderPath);
}

export function validateLibraryItem(
  type: MediaType,
  input: {
    folderName: string;
    parsedName: string;
    parsedYear: string | null;
    files?: string[];
    episodes?: Array<{ season: number; episode: number; fileName: string }>;
  },
  canonical: CanonicalMedia | null,
): NamingIssue[] {
  if (type === "movie") {
    return checkMovieNaming({
      folderName: input.folderName,
      parsedName: input.parsedName,
      parsedYear: input.parsedYear,
      files: input.files || [],
      canonical,
    });
  }
  return checkShowNaming({
    folderName: input.folderName,
    episodes: input.episodes || [],
    canonical,
  });
}
