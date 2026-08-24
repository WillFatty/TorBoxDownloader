
import { useEffect, useMemo, useState } from "react";
import { LibraryDetail } from "./LibraryDetail";
import {
  ArtThumb,
  readJson,
  type ArtworkEntry,
  type LibMovie,
  type LibSelection,
  type LibShow,
} from "./LibraryShared";

interface ArtworkItem {
  key: string;
  type: "movie" | "series";
  name: string;
  year: string | null;
  folderName: string;
  files?: string[];
  episodes?: LibShow["episodes"];
}

const ARTWORK_BATCH = 40;

function folderLabel(folder: string) {
  const parts = folder.split(/[/\\]/);
  return parts[parts.length - 1] || folder;
}

function hasNamingIssues(entry: ArtworkEntry | undefined): boolean {
  return Boolean(entry?.namingIssues?.length);
}

interface JellyfinCheck {
  checkedAt: string;
  totalItems: number;
  indexedItems: number;
  scanTriggered: boolean;
  scanError: string | null;
  summary: string;
  missingTotal: number;
  missing: Array<{ type: "movie" | "series"; name: string; year: string | null }>;
}

function JellyfinCard({
  result,
  busy,
}: {
  result: JellyfinCheck | null;
  busy: boolean;
}) {
  if (!result) return null;
  const missing = result.missingTotal > 0;

  return (
    <div className={`jf-card${missing ? " is-warn" : " is-ok"}`}>
      <div className="jf-card-head">
        <span
          className={`status-dot${busy ? " is-pulsing" : ""}`}
          aria-hidden="true"
        />
        <strong>Jellyfin metadata</strong>
        <span className="jf-card-time">
          {new Date(result.checkedAt).toLocaleTimeString()} ·{" "}
          {result.indexedItems}/{result.totalItems} indexed
        </span>
      </div>

      <p className="jf-card-summary">{result.summary}</p>
      {result.scanError && <p className="log-error">{result.scanError}</p>}

      {missing && (
        <>
          <div className="jf-missing">
            {result.missing.map((m) => (
              <span key={`${m.type}-${m.name}`} className="meta-tag">
                <b>{m.type === "movie" ? "Movie" : "TV"}</b>
                {m.name}
                {m.year ? ` (${m.year})` : ""}
              </span>
            ))}
            {result.missingTotal > result.missing.length && (
              <span className="meta-tag">+{result.missingTotal - result.missing.length} more</span>
            )}
          </div>
          <p className="jf-card-hint">
            Jellyfin is rescanning — give it a couple of minutes, then run the
            check again.
          </p>
        </>
      )}
    </div>
  );
}

export function LibraryPage() {
  const [tab, setTab] = useState<"movies" | "shows">("movies");
  const [q, setQ] = useState("");
  const [movies, setMovies] = useState<LibMovie[]>([]);
  const [shows, setShows] = useState<LibShow[]>([]);
  const [root, setRoot] = useState("");
  const [scannedAt, setScannedAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<LibSelection | null>(null);
  const [art, setArt] = useState<Record<string, ArtworkEntry>>({});
  const [brokenArt, setBrokenArt] = useState<Record<string, true>>({});
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [jfBusy, setJfBusy] = useState(false);
  const [jfResult, setJfResult] = useState<JellyfinCheck | null>(null);
  const [jfConfigured, setJfConfigured] = useState(true);

  function posterFor(key: string): string | null {
    return brokenArt[key] ? null : art[key]?.poster ?? null;
  }

  function markArtBroken(key: string) {
    setBrokenArt((prev) => ({ ...prev, [key]: true }));
  }

  async function reloadLibrary(force = false) {
    try {
      const res = await fetch(`/api/library${force ? "?force=1" : ""}`);
      const data = await readJson<{
        error?: string;
        library?: {
          movies?: LibMovie[];
          shows?: LibShow[];
          root?: string;
          scannedAt?: string;
          jellyfinConfigured?: boolean;
        };
      }>(res);
      if (!res.ok) throw new Error(data.error || "Scan failed");
      const library = data.library ?? {};
      setMovies(library.movies || []);
      setShows(library.shows || []);
      setRoot(library.root || "");
      setScannedAt(library.scannedAt || "");
      setJfConfigured(library.jellyfinConfigured !== false);
      return {
        movies: library.movies || [],
        shows: library.shows || [],
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      return null;
    }
  }

  async function load(force = false) {
    setLoading(true);
    setError(null);
    await reloadLibrary(force);
    setLoading(false);
  }

  async function refreshMetadata() {
    setJfBusy(true);
    setJfResult(null);
    try {
      const res = await fetch("/api/jellyfin/metadata", { method: "POST" });
      const data = await readJson<JellyfinCheck & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Jellyfin check failed");
      setJfResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jellyfin check failed");
    } finally {
      setJfBusy(false);
    }
  }

  async function handleNamingFixed(
    oldFolder: string,
    result: { newFolder: string },
  ) {
    setArt((prev) => {
      const next = { ...prev };
      delete next[oldFolder];
      return next;
    });

    const library = await reloadLibrary(true);
    if (!library || !selection) return;

    const targetFolder = result.newFolder;
    if (selection.kind === "movie") {
      const movie = library.movies.find((m) => m.folder === targetFolder);
      if (movie) setSelection({ kind: "movie", movie });
      else setSelection(null);
    } else {
      const show = library.shows.find((s) => s.folder === targetFolder);
      if (show) setSelection({ kind: "show", show });
      else setSelection(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Posters come from Cinemeta, which only knows titles, so they're resolved
  // after the scan and streamed in batches rather than blocking the listing.
  useEffect(() => {
    if (!movies.length && !shows.length) return;

    const wanted: ArtworkItem[] = [
      ...movies.map((m) => ({
        key: m.folder,
        type: "movie" as const,
        name: m.name,
        year: m.year,
        folderName: folderLabel(m.folder),
        files: m.files,
      })),
      ...shows.map((s) => ({
        key: s.folder,
        type: "series" as const,
        name: s.name,
        year: null,
        folderName: folderLabel(s.folder),
        episodes: s.episodes,
      })),
    ];

    let cancelled = false;

    void (async () => {
      for (let i = 0; i < wanted.length; i += ARTWORK_BATCH) {
        if (cancelled) return;
        try {
          const res = await fetch("/api/artwork", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: wanted.slice(i, i + ARTWORK_BATCH),
            }),
          });
          if (!res.ok) continue;
          const data = await readJson<{
            artwork?: Record<string, ArtworkEntry>;
          }>(res);
          if (cancelled) return;
          setArt((prev) => ({ ...prev, ...(data.artwork || {}) }));
        } catch {
          // Artwork is decorative; the lettered tiles stay as the fallback.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [movies, shows]);

  const filteredMovies = useMemo(() => {
    let list = movies;
    if (issuesOnly) {
      list = list.filter((m) => hasNamingIssues(art[m.folder]));
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) ||
        (m.year || "").includes(needle),
    );
  }, [movies, q, issuesOnly, art]);

  const filteredShows = useMemo(() => {
    let list = shows;
    if (issuesOnly) {
      list = list.filter((s) => hasNamingIssues(art[s.folder]));
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((s) => s.name.toLowerCase().includes(needle));
  }, [shows, q, issuesOnly, art]);

  const episodeTotal = useMemo(
    () => shows.reduce((sum, s) => sum + s.episodeCount, 0),
    [shows],
  );
  const movieFileTotal = useMemo(
    () => movies.reduce((sum, m) => sum + m.fileCount, 0),
    [movies],
  );
  const namingIssueCount = useMemo(() => {
    const keys = new Set([
      ...movies.map((m) => m.folder),
      ...shows.map((s) => s.folder),
    ]);
    let count = 0;
    for (const key of keys) {
      if (hasNamingIssues(art[key])) count += 1;
    }
    return count;
  }, [movies, shows, art]);

  const total = tab === "movies" ? movies.length : shows.length;
  const shown = tab === "movies" ? filteredMovies.length : filteredShows.length;
  const filtering = q.trim().length > 0 || issuesOnly;

  return (
    <div className="page-shell page-shell-wide page-enter">
      <div className="page-header">
        <div>
          <p className="page-kicker">Local</p>
          <h1 className="page-title">Library</h1>
          <p className="page-desc">
            Your scanned Jellyfin collection.
            {scannedAt
              ? ` Last scan ${new Date(scannedAt).toLocaleString()}.`
              : ""}
          </p>
          {root && (
            <p className="lib-root">
              <span>Root</span>
              <code>{root}</code>
            </p>
          )}
        </div>
        <div className="page-actions">
          {jfConfigured && (
            <button
              type="button"
              className="btn-secondary"
              disabled={jfBusy || loading}
              onClick={() => void refreshMetadata()}
            >
              {jfBusy ? "Checking…" : "Refresh metadata"}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => void load(true)}
          >
            {loading ? "Scanning…" : "Rescan"}
          </button>
        </div>
      </div>

      <JellyfinCard result={jfResult} busy={jfBusy} />

      <div className="lib-stats">
        <div className="lib-stat">
          <span className="lib-stat-value">{movies.length}</span>
          <span className="lib-stat-label">Movies</span>
        </div>
        <div className="lib-stat">
          <span className="lib-stat-value">{shows.length}</span>
          <span className="lib-stat-label">TV shows</span>
        </div>
        <div className="lib-stat">
          <span className="lib-stat-value">{episodeTotal}</span>
          <span className="lib-stat-label">Episodes</span>
        </div>
        <div className="lib-stat">
          <span className="lib-stat-value">{movieFileTotal}</span>
          <span className="lib-stat-label">Movie files</span>
        </div>
        <div className="lib-stat lib-stat-warn">
          <span className="lib-stat-value">{namingIssueCount}</span>
          <span className="lib-stat-label">Naming issues</span>
        </div>
      </div>

      <div className="lib-toolbar">
        <div className="segmented">
          <button
            type="button"
            className={tab === "movies" ? "is-active" : ""}
            onClick={() => setTab("movies")}
          >
            Movies
            <span className="segmented-count">{movies.length}</span>
          </button>
          <button
            type="button"
            className={tab === "shows" ? "is-active" : ""}
            onClick={() => setTab("shows")}
          >
            TV Shows
            <span className="segmented-count">{shows.length}</span>
          </button>
        </div>

        <div className="lib-search">
          <input
            className="field"
            placeholder={
              tab === "movies" ? "Filter movies…" : "Filter TV shows…"
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {filtering && (
            <button
              type="button"
              className="lib-search-clear"
              aria-label="Clear filter"
              onClick={() => setQ("")}
            >
              ×
            </button>
          )}
        </div>

        {filtering && (
          <p className="lib-count">
            {shown} of {total}
          </p>
        )}

        <button
          type="button"
          className={`chip${issuesOnly ? " chip-active" : ""}`}
          onClick={() => setIssuesOnly((v) => !v)}
        >
          Naming issues
          <span className="segmented-count">{namingIssueCount}</span>
        </button>
      </div>

      {error && <p className="text-danger lib-message">{error}</p>}

      {loading && (
        <div className="lib-grid" aria-hidden="true">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="lib-card lib-skeleton" />
          ))}
        </div>
      )}

      {!loading && tab === "movies" && (
        <>
          {filteredMovies.length ? (
            <div className="lib-grid">
              {filteredMovies.map((m) => {
                const issues = art[m.folder]?.namingIssues || [];
                return (
                <button
                  key={m.folder}
                  type="button"
                  className={`lib-card${issues.length ? " has-naming-issue" : ""}`}
                  onClick={() => setSelection({ kind: "movie", movie: m })}
                >
                  <ArtThumb
                    name={m.name}
                    poster={posterFor(m.folder)}
                    onError={() => markArtBroken(m.folder)}
                  />
                  <span className="lib-card-meta">
                    <span className="lib-card-title">{m.name}</span>
                    <span className="lib-card-sub">
                      {m.year || "Unknown year"} · {m.fileCount} file
                      {m.fileCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  {issues.length > 0 && (
                    <span
                      className="lib-issue-badge"
                      title={`${issues.length} naming issue${issues.length === 1 ? "" : "s"}`}
                    >
                      {issues.length}
                    </span>
                  )}
                </button>
              );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <strong>{filtering ? "No matches" : "No movies yet"}</strong>
              <p className="muted" style={{ margin: 0 }}>
                {issuesOnly
                  ? "No naming issues found in this tab."
                  : filtering
                    ? "Try a different search term."
                    : "Downloaded movies will show up here after a scan."}
              </p>
            </div>
          )}
        </>
      )}

      {!loading && tab === "shows" && (
        <>
          {filteredShows.length ? (
            <div className="lib-grid">
              {filteredShows.map((s) => {
                const issues = art[s.folder]?.namingIssues || [];
                return (
                <button
                  key={s.folder}
                  type="button"
                  className={`lib-card${issues.length ? " has-naming-issue" : ""}`}
                  onClick={() => setSelection({ kind: "show", show: s })}
                >
                  <ArtThumb
                    name={s.name}
                    poster={posterFor(s.folder)}
                    onError={() => markArtBroken(s.folder)}
                  />
                  <span className="lib-card-meta">
                    <span className="lib-card-title">{s.name}</span>
                    <span className="lib-card-sub">
                      {s.seasons.length} season
                      {s.seasons.length === 1 ? "" : "s"} · {s.episodeCount}{" "}
                      episode{s.episodeCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  {issues.length > 0 && (
                    <span
                      className="lib-issue-badge"
                      title={`${issues.length} naming issue${issues.length === 1 ? "" : "s"}`}
                    >
                      {issues.length}
                    </span>
                  )}
                </button>
              );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <strong>{filtering ? "No matches" : "No TV shows yet"}</strong>
              <p className="muted" style={{ margin: 0 }}>
                {issuesOnly
                  ? "No naming issues found in this tab."
                  : filtering
                    ? "Try a different search term."
                    : "Downloaded series will show up here after a scan."}
              </p>
            </div>
          )}
        </>
      )}

      {selection && (
        <LibraryDetail
          selection={selection}
          jellyfinConfigured={jfConfigured}
          art={
            art[
              selection.kind === "movie"
                ? selection.movie.folder
                : selection.show.folder
            ]
          }
          onClose={() => setSelection(null)}
          onFixed={(oldFolder, result) =>
            void handleNamingFixed(oldFolder, result)
          }
        />
      )}
    </div>
  );
}
