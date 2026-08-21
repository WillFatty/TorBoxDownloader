"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DownloadJob,
  MediaMeta,
  MediaType,
  SearchResult,
  StreamResult,
} from "@/lib/types";

function formatStatus(status: DownloadJob["status"]) {
  return status.replace(/_/g, " ");
}

function normTitle(s: string) {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface LibSnapshot {
  movies: Array<{ name: string; year: string | null; fileCount: number }>;
  shows: Array<{
    name: string;
    seasons: number[];
    episodeCount: number;
    episodes: Array<{ season: number; episode: number }>;
  }>;
}

export function DownloaderApp() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | MediaType>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibSnapshot | null>(null);

  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);

  const [streams, setStreams] = useState<StreamResult[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [cacheFilter, setCacheFilter] = useState<"all" | "cached" | "uncached">(
    "all",
  );
  const [qualityFilter, setQualityFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"quality" | "size" | "cached">(
    "quality",
  );
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [cacheChecked, setCacheChecked] = useState(false);

  const [picked, setPicked] = useState<StreamResult | null>(null);
  const [useAutoName, setUseAutoName] = useState(true);
  const [customName, setCustomName] = useState("");
  const [autoPreview, setAutoPreview] = useState("");
  const [pathPreview, setPathPreview] = useState("");
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [recentJobs, setRecentJobs] = useState<DownloadJob[]>([]);

  const seasons = useMemo(() => {
    if (!meta?.videos?.length) return [1];
    return [...new Set(meta.videos.map((v) => v.season))].sort((a, b) => a - b);
  }, [meta]);

  const episodes = useMemo(() => {
    if (!meta?.videos?.length) return [1];
    return meta.videos
      .filter((v) => v.season === season)
      .map((v) => v.episode)
      .sort((a, b) => a - b);
  }, [meta, season]);

  const qualityOptions = useMemo(() => {
    const rank: Record<string, number> = {
      "2160p": 4,
      "1080p": 3,
      "720p": 2,
      "480p": 1,
      Unknown: -1,
    };
    const set = new Set(streams.map((s) => s.quality || "Unknown"));
    return [...set].sort(
      (a, b) => (rank[b] ?? 0) - (rank[a] ?? 0) || a.localeCompare(b),
    );
  }, [streams]);

  const filteredStreams = useMemo(() => {
    const rank: Record<string, number> = {
      "2160p": 4,
      "1080p": 3,
      "720p": 2,
      "480p": 1,
    };
    let list = streams.filter((s) => {
      if (cacheFilter === "cached" && !s.cached) return false;
      if (cacheFilter === "uncached" && s.cached) return false;
      if (qualityFilter !== "all" && s.quality !== qualityFilter) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === "cached") {
        const c = Number(b.cached) - Number(a.cached);
        if (c !== 0) return c;
      }
      if (sortBy === "size") {
        return (b.sizeBytes || 0) - (a.sizeBytes || 0);
      }
      const qa = rank[a.quality] ?? 0;
      const qb = rank[b.quality] ?? 0;
      if (qb !== qa) return qb - qa;
      return (b.sizeBytes || 0) - (a.sizeBytes || 0);
    });
    return list;
  }, [streams, cacheFilter, qualityFilter, sortBy]);

  const cachedCount = useMemo(
    () => streams.filter((s) => s.cached).length,
    [streams],
  );

  useEffect(() => {
    if (!episodes.includes(episode) && episodes.length) {
      setEpisode(episodes[0]);
    }
  }, [episodes, episode]);

  useEffect(() => {
    if (
      picked &&
      !filteredStreams.some(
        (s) => s.infoHash === picked.infoHash && s.title === picked.title,
      )
    ) {
      setPicked(null);
    }
  }, [filteredStreams, picked]);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSelected(null);
    setMeta(null);
    setStreams([]);
    setPicked(null);
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.results || []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function selectTitle(item: SearchResult) {
    setSelected(item);
    setPicked(null);
    setStreams([]);
    setStreamError(null);
    setDownloadMsg(null);
    setUseAutoName(true);
    setCustomName("");

    const res = await fetch(
      `/api/meta?type=${item.type}&id=${encodeURIComponent(item.imdbId)}`,
    );
    const data = await res.json();
    if (res.ok) {
      setMeta(data.meta);
      if (item.type === "series" && data.meta?.videos?.length) {
        const first = data.meta.videos[0];
        setSeason(first.season);
        setEpisode(first.episode);
      }
    } else {
      setMeta(null);
    }

    if (item.type === "movie") {
      await loadStreams(item, null, null);
    }
  }

  async function loadStreams(
    item: SearchResult,
    s: number | null,
    ep: number | null,
  ) {
    setLoadingStreams(true);
    setStreamError(null);
    setStreams([]);
    setPicked(null);
    setCacheFilter("all");
    setQualityFilter("all");
    setSortBy("quality");
    setCacheError(null);
    setCacheChecked(false);
    try {
      const params = new URLSearchParams({
        type: item.type,
        id: item.imdbId,
      });
      if (item.type === "series" && s != null && ep != null) {
        params.set("season", String(s));
        params.set("episode", String(ep));
      }
      const res = await fetch(`/api/streams?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load streams");
      setStreams(data.streams || []);
      setCacheError(data.cacheError || null);
      setCacheChecked(Boolean(data.cacheChecked));
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : "Stream error");
    } finally {
      setLoadingStreams(false);
    }
  }

  const episodeTitle = useMemo(() => {
    if (!meta?.videos?.length) return null;
    const match = meta.videos.find(
      (v) => v.season === season && v.episode === episode,
    );
    return match?.title || null;
  }, [meta, season, episode]);

  const ownedMovie = useMemo(() => {
    if (!library || !selected || selected.type !== "movie") return null;
    return (
      library.movies.find(
        (m) =>
          normTitle(m.name) === normTitle(selected.name) &&
          (!selected.year || !m.year || m.year === selected.year) &&
          m.fileCount > 0,
      ) || null
    );
  }, [library, selected]);

  const ownedShow = useMemo(() => {
    if (!library || !selected || selected.type !== "series") return null;
    return (
      library.shows.find(
        (s) => normTitle(s.name) === normTitle(selected.name),
      ) || null
    );
  }, [library, selected]);

  const ownedEpisode = useMemo(() => {
    if (!ownedShow) return false;
    return ownedShow.episodes.some(
      (e) => e.season === season && e.episode === episode,
    );
  }, [ownedShow, season, episode]);

  function libraryBadge(item: SearchResult): string | null {
    if (!library) return null;
    if (item.type === "movie") {
      const hit = library.movies.find(
        (m) =>
          normTitle(m.name) === normTitle(item.name) &&
          (!item.year || !m.year || m.year === item.year) &&
          m.fileCount > 0,
      );
      return hit ? "In library" : null;
    }
    const show = library.shows.find(
      (s) => normTitle(s.name) === normTitle(item.name),
    );
    if (!show) return null;
    return `${show.episodeCount} ep in library`;
  }

  useEffect(() => {
    void fetch("/api/library")
      .then((r) => r.json())
      .then((d) => {
        if (d.library) {
          setLibrary({
            movies: d.library.movies || [],
            shows: d.library.shows || [],
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!picked || !selected) {
      setAutoPreview("");
      setPathPreview("");
      return;
    }
    const ext =
      picked.filename?.match(/\.(mkv|mp4|avi|m4v|ts)$/i)?.[1]?.toLowerCase() ||
      "mkv";
    void fetch("/api/filename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaName: selected.name,
        year: selected.year,
        mediaType: selected.type,
        season: selected.type === "series" ? season : null,
        episode: selected.type === "series" ? episode : null,
        episodeTitle: selected.type === "series" ? episodeTitle : null,
        quality: picked.quality,
        extension: ext,
        useAutoName: true,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        setAutoPreview(d.fileName || "");
        setPathPreview(d.absolutePath || d.relativePath || "");
        if (useAutoName) setCustomName(d.fileName || "");
      });
  }, [picked, selected, season, episode, episodeTitle, useAutoName]);

  async function startDownload() {
    if (!selected || !picked) return;
    setDownloading(true);
    setDownloadMsg(null);
    try {
      const ext =
        picked.filename?.match(/\.(mkv|mp4|avi|m4v|ts)$/i)?.[1]?.toLowerCase() ||
        "mkv";
      const episodeTitles: Record<string, string> = {};
      if (selected.type === "series" && meta?.videos?.length) {
        for (const v of meta.videos) {
          if (v.title) episodeTitles[`${v.season}:${v.episode}`] = v.title;
        }
      }
      const res = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          infoHash: picked.infoHash,
          fileIdx: picked.fileIdx,
          mediaName: selected.name,
          mediaType: selected.type,
          imdbId: selected.imdbId || selected.id,
          year: selected.year,
          season: selected.type === "series" ? season : null,
          episode: selected.type === "series" ? episode : null,
          episodeTitle: selected.type === "series" ? episodeTitle : null,
          episodeTitles:
            selected.type === "series" && Object.keys(episodeTitles).length
              ? episodeTitles
              : null,
          quality: picked.quality,
          extension: ext,
          useAutoName,
          customFileName: useAutoName ? null : customName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Download failed");
      const msg = data.job.packSummary
        ? `Queued pack: ${data.job.packSummary}`
        : data.job.multiEpisode
          ? `Queued multi-episode → ${data.job.downloadPath}`
          : `Queued: ${data.job.downloadPath}`;
      setDownloadMsg(
        picked.packHint
          ? `${msg} (detected ${picked.packHint} — all episodes will be saved)`
          : msg,
      );
      setRecentJobs((prev) => [data.job, ...prev].slice(0, 5));
      pollJob(data.job.id);
      // refresh library after a bit when complete — poll handles status
    } catch (err) {
      setDownloadMsg(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  function pollJob(id: string) {
    const tick = async () => {
      const res = await fetch(`/api/downloads/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      const job = data.job as DownloadJob;
      setRecentJobs((prev) => {
        const rest = prev.filter((j) => j.id !== id);
        return [job, ...rest].slice(0, 5);
      });
      if (
        job.status !== "completed" &&
        job.status !== "failed" &&
        job.status !== "cancelled"
      ) {
        setTimeout(tick, 2000);
      } else if (job.status === "completed") {
        void fetch("/api/library")
          .then((r) => r.json())
          .then((d) => {
            if (d.library) {
              setLibrary({
                movies: d.library.movies || [],
                shows: d.library.shows || [],
              });
            }
          })
          .catch(() => {});
      }
    };
    void tick();
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
      <section className="space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)] sm:text-4xl">
            Find & save
          </h1>
          <p className="mt-2 max-w-md text-[var(--muted)]">
            Search Cinemeta, pull streams from Comet, send to TorBox, rename,
            save local.
          </p>
        </div>

        <form onSubmit={runSearch} className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ant Man, Breaking Bad…"
              className="field flex-1"
              autoFocus
            />
            <button type="submit" className="btn-primary" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          <div className="flex gap-2">
            {(["all", "movie", "series"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`chip ${typeFilter === t ? "chip-active" : ""}`}
              >
                {t === "all" ? "All" : t === "movie" ? "Movies" : "TV"}
              </button>
            ))}
          </div>
        </form>

        {searchError && <p className="text-sm text-red-400">{searchError}</p>}

        <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {results.map((item) => (
            <button
              key={`${item.type}-${item.imdbId}`}
              type="button"
              onClick={() => void selectTitle(item)}
              className={`flex w-full gap-3 rounded-lg border p-2 text-left transition ${
                selected?.imdbId === item.imdbId && selected.type === item.type
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--line-strong)]"
              }`}
            >
              {item.poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.poster}
                  alt=""
                  className="h-16 w-11 rounded object-cover"
                />
              ) : (
                <div className="flex h-16 w-11 items-center justify-center rounded bg-[var(--line)] text-xs text-[var(--muted)]">
                  N/A
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate font-medium text-[var(--ink)]">
                    {item.name}
                  </div>
                  {libraryBadge(item) && (
                    <span className="shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
                      {libraryBadge(item)}
                    </span>
                  )}
                </div>
                <div className="text-sm text-[var(--muted)]">
                  {item.year || "—"} · {item.type} · {item.imdbId}
                </div>
              </div>
            </button>
          ))}
          {!searching && results.length === 0 && query && (
            <p className="text-sm text-[var(--muted)]">No results.</p>
          )}
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-6">
        {!selected ? (
          <p className="text-[var(--muted)]">Pick a title to load streams.</p>
        ) : (
          <>
            <div className="flex gap-4">
              {selected.poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.poster}
                  alt=""
                  className="hidden h-28 w-20 rounded object-cover sm:block"
                />
              )}
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
                  {selected.name}
                </h2>
                <p className="text-sm text-[var(--muted)]">
                  {selected.year} · {selected.imdbId}
                </p>
                {ownedMovie && (
                  <p className="mt-1 text-sm text-sky-300">
                    Already in library ({ownedMovie.fileCount} file
                    {ownedMovie.fileCount === 1 ? "" : "s"}).
                  </p>
                )}
                {ownedShow && (
                  <p className="mt-1 text-sm text-sky-300">
                    In library · {ownedShow.episodeCount} episodes · seasons{" "}
                    {ownedShow.seasons.join(", ")}
                    {ownedEpisode ? " · this episode owned" : ""}
                  </p>
                )}
                {meta?.description && (
                  <p className="mt-2 line-clamp-3 text-sm text-[var(--muted)]">
                    {meta.description}
                  </p>
                )}
              </div>
            </div>

            {selected.type === "series" && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-[var(--muted)]">Season</span>
                  <select
                    className="field"
                    value={season}
                    onChange={(e) => setSeason(Number(e.target.value))}
                  >
                    {seasons.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[var(--muted)]">Episode</span>
                  <select
                    className="field"
                    value={episode}
                    onChange={(e) => setEpisode(Number(e.target.value))}
                  >
                    {episodes.map((ep) => (
                      <option key={ep} value={ep}>
                        {ep}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void loadStreams(selected, season, episode)}
                  disabled={loadingStreams}
                >
                  {loadingStreams ? "Loading…" : "Load streams"}
                </button>
              </div>
            )}

            {streamError && (
              <p className="text-sm text-red-400">{streamError}</p>
            )}
            {loadingStreams && (
              <p className="text-sm text-[var(--muted)]">Fetching Comet…</p>
            )}

            {streams.length > 0 && (
              <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[#100e0c] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                    Filters · {filteredStreams.length}/{streams.length}
                    {cachedCount > 0 ? ` · ${cachedCount} cached` : ""}
                  </span>
                  {(cacheFilter !== "all" ||
                    qualityFilter !== "all" ||
                    sortBy !== "quality") && (
                    <button
                      type="button"
                      className="text-xs text-[var(--accent)] hover:underline"
                      onClick={() => {
                        setCacheFilter("all");
                        setQualityFilter("all");
                        setSortBy("quality");
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>

                {cacheError && (
                  <p className="text-xs text-amber-400">
                    Cache check failed: {cacheError}
                  </p>
                )}
                {!cacheError && cacheChecked && cachedCount === 0 && (
                  <p className="text-xs text-[var(--muted)]">
                    TorBox reports 0 cached for these hashes.
                  </p>
                )}
                {!cacheError && !cacheChecked && streams.length > 0 && (
                  <p className="text-xs text-[var(--muted)]">
                    Set TorBox API key in Settings for cache badges.
                  </p>
                )}

                <div className="space-y-1.5">
                  <span className="text-xs text-[var(--muted)]">Cache</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["all", "All"],
                        ["cached", "Cached"],
                        ["uncached", "Uncached"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setCacheFilter(value)}
                        className={`chip ${cacheFilter === value ? "chip-active" : ""}`}
                      >
                        {label}
                        {value === "cached" && cachedCount > 0
                          ? ` (${cachedCount})`
                          : ""}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs text-[var(--muted)]">Resolution</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setQualityFilter("all")}
                      className={`chip ${qualityFilter === "all" ? "chip-active" : ""}`}
                    >
                      All
                    </button>
                    {qualityOptions.map((q) => {
                      const count = streams.filter((s) => s.quality === q).length;
                      return (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setQualityFilter(q)}
                          className={`chip ${qualityFilter === q ? "chip-active" : ""}`}
                        >
                          {q} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs text-[var(--muted)]">Sort</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["quality", "Quality"],
                        ["size", "Size"],
                        ["cached", "Cached first"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSortBy(value)}
                        className={`chip ${sortBy === value ? "chip-active" : ""}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="max-h-64 space-y-2 overflow-y-auto">
              {filteredStreams.map((s) => (
                <button
                  key={`${s.infoHash}-${s.title}`}
                  type="button"
                  onClick={() => setPicked(s)}
                  className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    picked?.infoHash === s.infoHash &&
                    picked.title === s.title
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--line)] hover:border-[var(--line-strong)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[var(--line)] px-1.5 py-0.5 text-xs font-medium">
                      {s.quality}
                    </span>
                    {s.cached && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs text-emerald-300">
                        TorBox cached
                      </span>
                    )}
                    {s.packHint && (
                      <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-xs text-violet-300">
                        {s.packHint}
                      </span>
                    )}
                    {s.size && (
                      <span className="text-[var(--muted)]">{s.size}</span>
                    )}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[var(--muted)]">
                    {s.title}
                  </div>
                </button>
              ))}
              {!loadingStreams &&
                streams.length > 0 &&
                filteredStreams.length === 0 && (
                  <p className="text-sm text-[var(--muted)]">
                    No streams match filters.
                  </p>
                )}
              {!loadingStreams &&
                streams.length === 0 &&
                selected.type === "movie" && (
                  <p className="text-sm text-[var(--muted)]">No streams found.</p>
                )}
            </div>

            {picked && (
              <div className="space-y-3 border-t border-[var(--line)] pt-4">
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={useAutoName}
                      onChange={() => setUseAutoName(true)}
                    />
                    Auto name
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={!useAutoName}
                      onChange={() => setUseAutoName(false)}
                    />
                    Custom name
                  </label>
                </div>
                <input
                  className="field w-full font-mono text-sm"
                  value={useAutoName ? autoPreview : customName}
                  onChange={(e) => {
                    setUseAutoName(false);
                    setCustomName(e.target.value);
                  }}
                  placeholder="Ant Man (2015) - 1080p.mkv"
                />
                {pathPreview && (
                  <p className="font-mono text-xs text-[var(--muted)]">
                    → {pathPreview}
                  </p>
                )}
                {picked.packHint && selected.type === "series" && (
                  <p className="text-xs text-violet-300">
                    Pack detected ({picked.packHint}). TorBox file list will be
                    scanned — every SxxExx video saves into the right Season
                    folder.
                  </p>
                )}
                {ownedEpisode && (
                  <p className="text-xs text-amber-400">
                    This episode already exists in your library.
                  </p>
                )}
                <button
                  type="button"
                  className="btn-primary w-full sm:w-auto"
                  disabled={downloading}
                  onClick={() => void startDownload()}
                >
                  {downloading
                    ? "Starting…"
                    : picked.packHint && selected.type === "series"
                      ? "Download pack via TorBox"
                      : "Download via TorBox"}
                </button>
                {downloadMsg && (
                  <p className="text-sm text-[var(--muted)]">{downloadMsg}</p>
                )}
              </div>
            )}
          </>
        )}

        {recentJobs.length > 0 && (
          <div className="border-t border-[var(--line)] pt-4">
            <h3 className="mb-2 text-sm font-medium text-[var(--ink)]">
              Active / recent
            </h3>
            <ul className="space-y-2">
              {recentJobs.map((job) => (
                <li
                  key={job.id}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{job.fileName}</span>
                    <span className="shrink-0 text-[var(--muted)]">
                      {formatStatus(job.status)} {job.progress}%
                    </span>
                  </div>
                  {job.packSummary && (
                    <p className="mt-1 text-xs text-violet-300">
                      {job.packSummary}
                    </p>
                  )}
                  {job.savedFiles?.length > 1 && (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {job.savedFiles.length} files saved
                    </p>
                  )}
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-[var(--line)]">
                    <div
                      className="h-full bg-[var(--accent)] transition-all"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  {job.error && (
                    <p className="mt-1 text-xs text-red-400">{job.error}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
