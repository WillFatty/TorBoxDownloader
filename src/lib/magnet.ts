const BTIH_RE = /btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i;
const BARE_HASH_RE = /^[a-fA-F0-9]{40}$|^[a-zA-Z2-7]{32}$/;

export function extractInfoHash(input: string): string | null {
  const trimmed = input.trim();
  const m = trimmed.match(BTIH_RE);
  if (m) return m[1].toLowerCase();
  if (BARE_HASH_RE.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

export function displayNameFromMagnet(input: string): string | null {
  const m = input.match(/[?&]dn=([^&#]*)/i);
  if (!m) return null;
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep raw on malformed escapes
  }
  raw = raw.replace(/\+/g, " ").trim();
  return raw || null;
}

const EP_MARKERS: RegExp[] = [
  /[Ss]\d{1,2}[Ee]\d{1,3}/,
  /\b\d{1,2}x\d{1,3}\b/i,
  /\bSeason[ ._-]*\d{1,2}[ ._-]*Episode[ ._-]*\d{1,3}\b/i,
];

// Season markers without an episode number ("S01.COMPLETE", "Season 2").
const SEASON_MARKERS: RegExp[] = [
  /\b[Ss]\d{1,2}(?![A-Za-z\d])(?![Ee]\d)/,
  /\bSeason[ ._-]*\d{1,2}(?![ ._-]*Episode)/i,
];

const NOISE_RE =
  /\b(2160p|1080p|1080i|720p|480p|360p|4k|uhd|hdr10?|hdr\+|dv|dolby[ ._-]?vision|remux|bluray|blu-ray|bdrip|brrip|web[ ._-]?dl|webdl|webrip|hdtv|dvdrip|dvd|x264|x265|h\.?264|h\.?265|hevc|avc|xvid|aac|ac3|eac3|ddp|dts(-hd)?|truehd|atmos|flac|mp3|10bit|8bit|hi10p?|proper|repack|extended|unrated|remastered|internal|limited|wide?screen|multi|dual[ ._-]?audio|complete|imi?ax|amzn|nf|netflix|atvp|dsnp|hulu|pcok|max|tubi|pdtv|aac2[ ._]0|2[ ._]0|5[ ._]1|7[ ._]1)\b/gi;

export interface CleanedTorrentTitle {
  title: string;
  season: number | null;
  episode: number | null;
  year: string | null;
}

/** Turn a torrent display name into a searchable media title. */
export function cleanTorrentTitle(displayName: string): CleanedTorrentTitle {
  let text = displayName;

  let season: number | null = null;
  let episode: number | null = null;
  for (let i = 0; i < EP_MARKERS.length && season == null; i++) {
    const m = text.match(EP_MARKERS[i]);
    if (!m) continue;
    const nums = m[0].match(/\d+/g) || [];
    if (nums.length >= 2) {
      const s = Number.parseInt(nums[0] ?? "", 10);
      const e = Number.parseInt(nums[1] ?? "", 10);
      if (Number.isFinite(s) && Number.isFinite(e)) {
        season = s;
        episode = e;
      }
    }
  }
  if (season == null) {
    // Season pack / no episode number ("Show.S01.COMPLETE").
    for (let i = 0; i < SEASON_MARKERS.length && season == null; i++) {
      const m = text.match(SEASON_MARKERS[i]);
      if (!m) continue;
      const s = Number.parseInt((m[0].match(/\d+/g) || [])[0] ?? "", 10);
      if (Number.isFinite(s)) season = s;
    }
  }
  for (const re of [...EP_MARKERS, ...SEASON_MARKERS])
    text = text.replace(new RegExp(re.source, "gi"), " ");

  // Release year: trust a lone year-like token when it's clearly a series
  // (season/episode markers present), otherwise require two year tokens so
  // titles like "1917" or "2049" stay intact.
  const yearMatches = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)];
  let year: string | null = null;
  const lastYear = yearMatches[yearMatches.length - 1];
  const trustSingleYear = lastYear != null && (season != null || episode != null);
  if (lastYear?.[1] && (yearMatches.length >= 2 || trustSingleYear)) {
    year = lastYear[1];
    const idx = lastYear.index;
    if (idx != null) {
      text = `${text.slice(0, idx)} ${text.slice(idx + year.length)}`;
    }
  }

  text = text.replace(/\[[^\]]*\]/g, " ");
  text = text.replace(NOISE_RE, " ");
  text = text.replace(/\.[a-z0-9]{2,4}\b\s*$/i, " ");
  text = text.replace(/[._]+/g, " ");
  text = text.replace(/\s{2,}/g, " ").trim();
  // Trailing release-group tag ("x264-NTG" after the codec is stripped).
  text = text.replace(/\s+-[A-Za-z0-9]{1,}$/, "");
  text = text.replace(/^[\s\-–—:;,[({]+|[\s\-–—:;,)\]}]+$/g, "").trim();

  return { title: text, season, episode, year };
}

function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleScore(a: string, b: string): number {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (nb.startsWith(na) || na.startsWith(nb)) return 80;
  if (nb.includes(na) || na.includes(nb)) return 60;
  const aTokens = new Set(na.split(" "));
  const bTokens = nb.split(" ");
  const hits = bTokens.filter((t) => aTokens.has(t)).length;
  return Math.round((hits / Math.max(aTokens.size, 1)) * 50);
}

interface SearchHit {
  type: "movie" | "series";
  imdbId: string;
  name: string;
  year: string;
  poster: string | null;
}

/**
 * Pick the best Cinemeta match for a cleaned torrent title.
 * Returns null when nothing plausibly matches.
 */
export function bestSearchMatch(
  cleaned: CleanedTorrentTitle,
  results: SearchHit[],
): SearchHit | null {
  if (!results.length) return null;
  let best: { hit: SearchHit; score: number } | null = null;
  for (const hit of results) {
    let score = titleScore(cleaned.title, hit.name);
    if (cleaned.year && hit.year === cleaned.year) score += 15;
    // A torrent with S/E markers is essentially never a movie.
    if ((cleaned.season != null || cleaned.episode != null) && hit.type === "series")
      score += 10;
    if (!best || score > best.score) best = { hit, score };
  }
  if (!best || best.score < 45) return null;
  return best.hit;
}
