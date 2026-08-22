"use client";

import { useEffect, useMemo, useState } from "react";
import { LibraryDetail } from "./LibraryDetail";
import {
  ArtThumb,
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
}

const ARTWORK_BATCH = 40;

function OpenArrow() {
  return (
    <svg className="lib-chev" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

  function posterFor(key: string): string | null {
    return brokenArt[key] ? null : art[key]?.poster ?? null;
  }

  function markArtBroken(key: string) {
    setBrokenArt((prev) => ({ ...prev, [key]: true }));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setMovies(data.library.movies || []);
      setShows(data.library.shows || []);
      setRoot(data.library.root || "");
      setScannedAt(data.library.scannedAt || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
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
      })),
      ...shows.map((s) => ({
        key: s.folder,
        type: "series" as const,
        name: s.name,
        year: null,
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
          const data = (await res.json()) as {
            artwork?: Record<string, ArtworkEntry>;
          };
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
    const needle = q.trim().toLowerCase();
    if (!needle) return movies;
    return movies.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) ||
        (m.year || "").includes(needle),
    );
  }, [movies, q]);

  const filteredShows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return shows;
    return shows.filter((s) => s.name.toLowerCase().includes(needle));
  }, [shows, q]);

  const episodeTotal = useMemo(
    () => shows.reduce((sum, s) => sum + s.episodeCount, 0),
    [shows],
  );
  const movieFileTotal = useMemo(
    () => movies.reduce((sum, m) => sum + m.fileCount, 0),
    [movies],
  );

  const total = tab === "movies" ? movies.length : shows.length;
  const shown = tab === "movies" ? filteredMovies.length : filteredShows.length;
  const filtering = q.trim().length > 0;

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
        <button
          type="button"
          className="btn-secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Scanning…" : "Rescan"}
        </button>
      </div>

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
              {filteredMovies.map((m) => (
                <button
                  key={m.folder}
                  type="button"
                  className="lib-card"
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
                  <OpenArrow />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>{filtering ? "No matches" : "No movies yet"}</strong>
              <p className="muted" style={{ margin: 0 }}>
                {filtering
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
              {filteredShows.map((s) => (
                <button
                  key={s.folder}
                  type="button"
                  className="lib-card"
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
                  <OpenArrow />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>{filtering ? "No matches" : "No TV shows yet"}</strong>
              <p className="muted" style={{ margin: 0 }}>
                {filtering
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
          art={
            art[
              selection.kind === "movie"
                ? selection.movie.folder
                : selection.show.folder
            ]
          }
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}
