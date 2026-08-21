"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

interface LibMovie {
  name: string;
  year: string | null;
  fileCount: number;
  files: string[];
  folder: string;
}

interface LibShow {
  name: string;
  seasons: number[];
  episodeCount: number;
  folder: string;
  episodes: Array<{ season: number; episode: number; fileName: string }>;
}

function tileInitials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function tileHue(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 3600;
  }
  return hash % 360;
}

function groupBySeason(episodes: LibShow["episodes"]) {
  const bySeason = new Map<number, LibShow["episodes"]>();
  for (const ep of episodes) {
    const list = bySeason.get(ep.season);
    if (list) list.push(ep);
    else bySeason.set(ep.season, [ep]);
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, eps]) => ({
      season,
      eps: [...eps].sort((a, b) => a.episode - b.episode),
    }));
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`lib-chev${open ? " is-open" : ""}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M6 9l6 6 6-6"
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
  const [expanded, setExpanded] = useState<string | null>(null);

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
              {filteredMovies.map((m) => {
                const open = expanded === m.folder;
                return (
                  <div
                    key={m.folder}
                    className={`lib-card${open ? " is-open" : ""}`}
                  >
                    <button
                      type="button"
                      className="lib-card-head"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : m.folder)}
                    >
                      <span
                        className="lib-tile"
                        style={{ "--tile-hue": tileHue(m.name) } as CSSProperties}
                      >
                        {tileInitials(m.name)}
                      </span>
                      <span className="lib-card-meta">
                        <span className="lib-card-title">{m.name}</span>
                        <span className="lib-card-sub">
                          {m.year || "Unknown year"} · {m.fileCount} file
                          {m.fileCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      <Chevron open={open} />
                    </button>
                    {open && (
                      <div className="lib-card-body">
                        <ul className="lib-file-list">
                          {m.files.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
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
              {filteredShows.map((s) => {
                const open = expanded === s.folder;
                return (
                  <div
                    key={s.folder}
                    className={`lib-card${open ? " is-open" : ""}`}
                  >
                    <button
                      type="button"
                      className="lib-card-head"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : s.folder)}
                    >
                      <span
                        className="lib-tile"
                        style={{ "--tile-hue": tileHue(s.name) } as CSSProperties}
                      >
                        {tileInitials(s.name)}
                      </span>
                      <span className="lib-card-meta">
                        <span className="lib-card-title">{s.name}</span>
                        <span className="lib-card-sub">
                          {s.seasons.length} season
                          {s.seasons.length === 1 ? "" : "s"} ·{" "}
                          {s.episodeCount} episode
                          {s.episodeCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      <Chevron open={open} />
                    </button>
                    {open && (
                      <div className="lib-card-body">
                        {groupBySeason(s.episodes).map((group) => (
                          <div key={group.season} className="lib-season">
                            <p className="lib-season-title">
                              Season {group.season}
                              <span>{group.eps.length}</span>
                            </p>
                            <ul className="lib-ep-list">
                              {group.eps.map((e) => (
                                <li key={`${e.season}-${e.episode}-${e.fileName}`}>
                                  <span className="lib-ep-num">
                                    E{String(e.episode).padStart(2, "0")}
                                  </span>
                                  <span className="lib-ep-file">
                                    {e.fileName}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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
    </div>
  );
}
