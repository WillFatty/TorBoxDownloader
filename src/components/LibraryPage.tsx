"use client";

import { useEffect, useMemo, useState } from "react";

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

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            Library
          </h1>
          <p className="mt-2 text-[var(--muted)]">
            Scanned Jellyfin libraries
            {root ? (
              <>
                : <code className="text-[var(--accent)]">{root}</code>
              </>
            ) : null}
          </p>
          {scannedAt && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {movies.length} movies · {shows.length} shows ·{" "}
              {new Date(scannedAt).toLocaleString()}
            </p>
          )}
        </div>
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          Rescan
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-2">
          <button
            type="button"
            className={`chip ${tab === "movies" ? "chip-active" : ""}`}
            onClick={() => setTab("movies")}
          >
            Movies ({movies.length})
          </button>
          <button
            type="button"
            className={`chip ${tab === "shows" ? "chip-active" : ""}`}
            onClick={() => setTab("shows")}
          >
            TV Shows ({shows.length})
          </button>
        </div>
        <input
          className="field flex-1"
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading && <p className="text-[var(--muted)]">Scanning…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && tab === "movies" && (
        <ul className="space-y-2">
          {filteredMovies.map((m) => (
            <li
              key={m.folder}
              className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 text-left"
                onClick={() =>
                  setExpanded(expanded === m.folder ? null : m.folder)
                }
              >
                <span className="font-medium text-[var(--ink)]">
                  {m.name}
                  {m.year ? ` (${m.year})` : ""}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {m.fileCount} file{m.fileCount === 1 ? "" : "s"}
                </span>
              </button>
              {expanded === m.folder && (
                <ul className="mt-2 space-y-1 border-t border-[var(--line)] pt-2 font-mono text-xs text-[var(--muted)]">
                  {m.files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {!filteredMovies.length && (
            <p className="text-[var(--muted)]">No movies found.</p>
          )}
        </ul>
      )}

      {!loading && tab === "shows" && (
        <ul className="space-y-2">
          {filteredShows.map((s) => (
            <li
              key={s.folder}
              className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 text-left"
                onClick={() =>
                  setExpanded(expanded === s.folder ? null : s.folder)
                }
              >
                <span className="font-medium text-[var(--ink)]">{s.name}</span>
                <span className="text-xs text-[var(--muted)]">
                  {s.seasons.length} season{s.seasons.length === 1 ? "" : "s"} ·{" "}
                  {s.episodeCount} ep
                </span>
              </button>
              {expanded === s.folder && (
                <div className="mt-2 max-h-64 space-y-1 overflow-y-auto border-t border-[var(--line)] pt-2 font-mono text-xs text-[var(--muted)]">
                  {s.episodes.map((e) => (
                    <div key={`${e.season}-${e.episode}-${e.fileName}`}>
                      S{String(e.season).padStart(2, "0")}E
                      {String(e.episode).padStart(2, "0")} · {e.fileName}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
          {!filteredShows.length && (
            <p className="text-[var(--muted)]">No TV shows found.</p>
          )}
        </ul>
      )}
    </div>
  );
}
