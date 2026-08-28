
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import type {
  DownloadJob,
  MediaMeta,
  MediaRatings,
  MediaType,
  SearchResult,
  StreamResult,
} from "@/lib/types";
import { readJson } from "./LibraryShared";

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

const TITLE_WINDOW = 28;
const TITLE_ROTATE_MS = 8000;

export function SearchWorkspace() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | MediaType>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibSnapshot | null>(null);

  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const [ratings, setRatings] = useState<MediaRatings | null>(null);
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
    if (qualityFilter !== "all") set.add(qualityFilter);
    return [...set].sort(
      (a, b) => (rank[b] ?? 0) - (rank[a] ?? 0) || a.localeCompare(b),
    );
  }, [streams, qualityFilter]);

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

  const libraryCounts = useMemo(() => {
    if (!library) return null;
    return {
      movies: library.movies.length,
      shows: library.shows.length,
      episodes: library.shows.reduce((sum, s) => sum + s.episodeCount, 0),
    };
  }, [library]);

  const allLibraryTitles = useMemo(() => {
    if (!library) return [];
    const movies = library.movies;
    const shows = library.shows;
    const out: string[] = [];
    const max = Math.max(movies.length, shows.length);
    for (let i = 0; i < max; i++) {
      if (movies[i]) out.push(movies[i].name);
      if (shows[i]) out.push(shows[i].name);
    }
    return out;
  }, [library]);

  const [titleOffset, setTitleOffset] = useState(0);

  useEffect(() => {
    if (allLibraryTitles.length <= TITLE_WINDOW) return;
    const t = setInterval(
      () => setTitleOffset((o) => o + TITLE_WINDOW),
      TITLE_ROTATE_MS,
    );
    return () => clearInterval(t);
  }, [allLibraryTitles.length]);

  const libraryTitles = useMemo(() => {
    const n = allLibraryTitles.length;
    if (!n) return [];
    return Array.from(
      { length: Math.min(TITLE_WINDOW, n) },
      (_, i) => allLibraryTitles[(titleOffset + i) % n],
    );
  }, [allLibraryTitles, titleOffset]);

  const topShows = useMemo(() => {
    if (!library?.shows.length) return [];
    const max = Math.max(...library.shows.map((s) => s.episodeCount), 1);
    return [...library.shows]
      .sort((a, b) => b.episodeCount - a.episodeCount)
      .slice(0, 8)
      .map((s) => ({
        name: s.name,
        eps: s.episodeCount,
        pct: Math.round((s.episodeCount / max) * 100),
      }));
  }, [library]);

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

  function looksLikeMagnet(value: string): boolean {
    const t = value.trim();
    return (
      /^magnet:\?/i.test(t) ||
      /^[a-fA-F0-9]{40}$/.test(t) ||
      /^[a-zA-Z2-7]{32}$/.test(t)
    );
  }

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (looksLikeMagnet(q)) {
      await handleMagnet(q);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSelected(null);
    setMeta(null);
    setStreams([]);
    setPicked(null);
    try {
      const params = new URLSearchParams({ q });
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await fetch(`/api/search?${params}`);
      const data = await readJson<{
        error?: string;
        results?: SearchResult[];
      }>(res);
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.results || []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleMagnet(raw: string) {
    setSearching(true);
    setSearchError(null);
    setSelected(null);
    setMeta(null);
    setStreams([]);
    setPicked(null);
    try {
      const res = await fetch("/api/magnet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet: raw }),
      });
      const data = await readJson<{
        error?: string;
        infoHash?: string;
        displayName?: string | null;
        cleanTitle?: string;
        quality?: string;
        packLabel?: string | null;
        season?: number | null;
        episode?: number | null;
        match?: {
          type: MediaType;
          imdbId: string;
          name: string;
          year: string;
          poster: string | null;
        } | null;
      }>(res);
      if (!res.ok || !data.infoHash || !data.match) {
        throw new Error(data.error || "Couldn't process that magnet");
      }
      const match = data.match;
      const item: SearchResult = {
        id: match.imdbId,
        imdbId: match.imdbId,
        type: match.type,
        name: match.name,
        year: match.year,
        poster: match.poster,
      };
      const presetStream: StreamResult = {
        infoHash: data.infoHash,
        title: data.displayName || data.cleanTitle || item.name,
        name: "Magnet",
        quality: data.quality || "Unknown",
        size: null,
        sizeBytes: null,
        seeds: null,
        fileIdx: null,
        filename: null,
        cached: null,
        url: null,
        packHint: data.packLabel ?? null,
      };
      setQuery(item.name);
      setResults([item]);
      await selectTitle(item, {
        presetStream,
        season: data.season,
        episode: data.episode,
      });
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Magnet lookup failed",
      );
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function selectTitle(
    item: SearchResult,
    opts?: {
      presetStream?: StreamResult;
      season?: number | null;
      episode?: number | null;
    },
  ) {
    setSelected(item);
    setPicked(null);
    setStreams([]);
    setStreamError(null);
    setDownloadMsg(null);
    setUseAutoName(true);
    setCustomName("");
    setCacheFilter("all");
    setQualityFilter("all");
    setSortBy("quality");
    setCacheError(null);
    setCacheChecked(false);
    setRatings(null);

    const res = await fetch(
      `/api/meta?type=${item.type}&id=${encodeURIComponent(item.imdbId)}`,
    );
    const data = await readJson<{ meta?: MediaMeta }>(res);
    if (res.ok) {
      setMeta(data.meta ?? null);
      if (item.type === "series" && data.meta?.videos?.length) {
        const videos = data.meta.videos;
        const seasonList = [...new Set(videos.map((v) => v.season))];
        const wantedSeason =
          opts?.season != null && seasonList.includes(opts.season)
            ? opts.season
            : videos[0].season;
        setSeason(wantedSeason);
        const epsInSeason = videos
          .filter((v) => v.season === wantedSeason)
          .map((v) => v.episode);
        const wantedEpisode =
          opts?.episode != null && epsInSeason.includes(opts.episode)
            ? opts.episode
            : (epsInSeason[0] ?? 1);
        setEpisode(wantedEpisode);
      }
    } else {
      setMeta(null);
    }

    void fetch(
      `/api/ratings?type=${item.type}&id=${encodeURIComponent(item.imdbId)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.ratings) setRatings(d.ratings as MediaRatings);
      })
      .catch(() => {});

    if (opts?.presetStream) {
      setStreams([opts.presetStream]);
      return;
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
      const data = await readJson<{
        error?: string;
        streams?: StreamResult[];
        cacheError?: string | null;
        cacheChecked?: boolean;
      }>(res);
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
    void fetch("/api/downloads")
      .then((r) => r.json())
      .then((d) => {
        const jobs = (d.jobs || []) as DownloadJob[];
        setRecentJobs((prev) => (prev.length ? prev : jobs.slice(0, 12)));
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
      const data = await readJson<{ error?: string; job?: DownloadJob & {
        packSummary?: string;
        multiEpisode?: boolean;
        downloadPath?: string;
      } }>(res);
      if (!res.ok || !data.job) {
        throw new Error(data.error || "Download failed");
      }
      const job = data.job;
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
      setRecentJobs((prev) => [job, ...prev].slice(0, 5));
      pollJob(job.id);
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
      const data = await readJson<{ job?: DownloadJob }>(res);
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
        setTimeout(tick, job.status === "saving" ? 1000 : 2000);
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
  const isHome = !results.length && !selected && !searching;

  const searchForm = (
    <form onSubmit={runSearch} className="search-form">
      <div className="search-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ant Man, Breaking Bad… or paste a magnet link"
          className="field"
          autoFocus={isHome}
        />
        <button type="submit" className="btn-primary" disabled={searching}>
          {searching ? "…" : "Search"}
        </button>
      </div>
      <div className="chip-row">
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
  );

  return (
    <div className={`workspace page-enter${isHome ? " is-home" : ""}`}>
      {!isHome && (
        <div className="workspace-toolbar">
          <div className="shell">
            <div className="toolbar-row">
              <div className="toolbar-copy">
                <h1>Search</h1>
                <p>Comet streams → TorBox → library</p>
              </div>
              {searchForm}
            </div>
            {searchError && (
              <p
                className="text-danger"
                style={{ marginTop: "0.75rem", fontSize: "0.875rem" }}
              >
                {searchError}
              </p>
            )}
          </div>
        </div>
      )}

      <div className={`workspace-body${selected ? " has-selection" : ""}`}>
        {isHome ? (
          <div className="home-stage">
            <div className="home-stage-inner">
              <header className="home-search">
                <div className="home-search-copy">
                  <p className="page-kicker">TorBoxDL</p>
                  <h1>Search your next title</h1>
                  <p className="home-search-sub">
                    Comet finds streams · TorBox caches · files land in Jellyfin
                  </p>
                </div>
                {searchForm}
                {searchError && (
                  <p className="text-danger home-search-error">{searchError}</p>
                )}
              </header>

              <section className="home-pulse">
                <div className="home-pulse-head">
                  <div>
                    <h2 className="home-section-title">In your library</h2>
                    {libraryCounts ? (
                      <p className="home-pulse-stats">
                        <strong>{libraryCounts.movies}</strong> movies
                        <span aria-hidden="true"> · </span>
                        <strong>{libraryCounts.shows}</strong> shows
                        <span aria-hidden="true"> · </span>
                        <strong>{libraryCounts.episodes}</strong> episodes
                      </p>
                    ) : (
                      <p className="muted home-pulse-stats">Loading library…</p>
                    )}
                  </div>
                  <Link to="/library" className="btn-secondary btn-small">
                    Browse library
                  </Link>
                </div>
                {libraryTitles.length > 0 ? (
                  <div key={titleOffset} className="home-title-cloud swap">
                    {libraryTitles.map((t, i) => (
                      <Link
                        key={`${t}-${i}`}
                        to="/library"
                        className="home-title-chip"
                      >
                        {t}
                      </Link>
                    ))}
                  </div>
                ) : libraryCounts ? (
                  <p className="muted">
                    No media yet — check your Jellyfin paths in Settings.
                  </p>
                ) : null}
              </section>

              <div className="home-columns">
                <section className="home-column">
                  <div className="home-column-head">
                    <h2 className="home-section-title">Biggest shows</h2>
                  </div>
                  {topShows.length > 0 ? (
                    <ul className="home-rank">
                      {topShows.map((s, i) => (
                        <li key={s.name} className="home-rank-item">
                          <span className="home-rank-num">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <div className="home-rank-main">
                            <div className="home-rank-row">
                              <span className="home-job-name">{s.name}</span>
                              <span className="home-rank-meta">
                                {s.eps} ep{s.eps === 1 ? "" : "s"}
                              </span>
                            </div>
                            <div className="progress-track">
                              <div
                                className="progress-fill"
                                style={{ width: `${Math.max(s.pct, 6)}%` }}
                              />
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No TV shows in the library yet.</p>
                  )}
                </section>

                <section className="home-column">
                  <div className="home-column-head">
                    <h2 className="home-section-title">Recent activity</h2>
                    <Link to="/logs">View logs</Link>
                  </div>
                  {recentJobs.length > 0 ? (
                    <ul className="home-activity">
                      {recentJobs.slice(0, 10).map((job) => (
                        <li key={job.id} className="home-activity-item">
                          <div className="home-activity-row">
                            <span className="home-job-name" title={job.fileName}>
                              {job.fileName}
                            </span>
                            <span className="home-activity-status">
                              {formatStatus(job.status)}
                              {job.progress > 0 && job.progress < 100
                                ? ` · ${job.progress}%`
                                : ""}
                            </span>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-fill"
                              style={{
                                width: `${Math.max(job.progress, 2)}%`,
                              }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">
                      No downloads yet — search a title to get started.
                    </p>
                  )}
                </section>
              </div>
            </div>
          </div>
        ) : (
          <>
        <aside className="pane pane-results">
          <div className="pane-inner">
            {searching && <p className="muted">Searching…</p>}

            {!searching && !results.length && (
              <div className="empty-state">
                <p>
                  {query
                    ? "No results for that search."
                    : "Search a title to get started."}
                </p>
              </div>
            )}

            {!!results.length && (
              <div className="result-list">
                {results.map((item) => {
                  const active =
                    selected?.imdbId === item.imdbId &&
                    selected.type === item.type;
                  const badge = libraryBadge(item);
                  return (
                    <button
                      key={`${item.type}-${item.imdbId}`}
                      type="button"
                      onClick={() => void selectTitle(item)}
                      className={`result-item${active ? " is-active" : ""}`}
                    >
                      {item.poster ? (
                        <img
                          src={item.poster}
                          alt=""
                          className="result-poster"
                        />
                      ) : (
                        <div className="result-poster result-poster-fallback">
                          N/A
                        </div>
                      )}
                      <div className="result-meta">
                        <div className="result-title">
                          {item.name}
                          {badge ? (
                            <span
                              className="badge"
                              style={{
                                marginLeft: "0.4rem",
                                background: "rgba(94,200,255,0.15)",
                                color: "var(--info)",
                                verticalAlign: "middle",
                              }}
                            >
                              {badge}
                            </span>
                          ) : null}
                        </div>
                        <div className="result-sub">
                          {item.year || "—"} · {item.type}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="pane pane-detail">
          <div className="pane-inner stack">
            {!selected ? (
              <div className="empty-state">
                <strong>Select a title</strong>
                <p>Streams, naming, and download controls appear here.</p>
              </div>
            ) : (
              <>
                <div className="detail-header">
                  {selected.poster ? (
                    <img
                      src={selected.poster}
                      alt=""
                      className="detail-poster"
                    />
                  ) : null}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h2>{selected.name}</h2>
                    <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.875rem" }}>
                      {selected.year} · {selected.imdbId}
                    </p>
                    {ratings?.scores.length ? (
                      <div className="score-row" style={{ marginTop: "0.6rem" }}>
                        {ratings.scores.map((score) => (
                          <a
                            key={score.source}
                            href={score.url}
                            target="_blank"
                            rel="noreferrer"
                            className={`score-chip score-chip--${score.source
                              .toLowerCase()
                              .replace(/[^a-z]+/g, "-")}`}
                            title={score.url}
                          >
                            <span className="score-chip-source">
                              <span>{score.source}</span>
                            </span>
                            <span className="score-chip-value">
                              {score.value}
                            </span>
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {ratings?.summary ? (
                      <p
                        className="score-summary"
                        style={{ margin: "0.5rem 0 0" }}
                      >
                        {ratings.summary}
                      </p>
                    ) : null}
                    {ownedMovie && (
                      <p className="text-info" style={{ margin: "0.5rem 0 0", fontSize: "0.875rem" }}>
                        Already in library ({ownedMovie.fileCount} file
                        {ownedMovie.fileCount === 1 ? "" : "s"}).
                      </p>
                    )}
                    {ownedShow && (
                      <p className="text-info" style={{ margin: "0.5rem 0 0", fontSize: "0.875rem" }}>
                        In library · {ownedShow.episodeCount} episodes · seasons{" "}
                        {ownedShow.seasons.join(", ")}
                        {ownedEpisode ? " · this episode owned" : ""}
                      </p>
                    )}
                    {meta?.description && (
                      <p
                        className="muted"
                        style={{
                          margin: "0.75rem 0 0",
                          fontSize: "0.875rem",
                          lineHeight: 1.5,
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {meta.description}
                      </p>
                    )}
                  </div>
                </div>

                {selected.type === "series" && (
                  <div className="episode-box row">
                    <label style={{ fontSize: "0.875rem" }}>
                      <span
                        className="muted"
                        style={{
                          display: "block",
                          marginBottom: "0.35rem",
                          fontSize: "0.7rem",
                          fontWeight: 650,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                        }}
                      >
                        Season
                      </span>
                      <select
                        className="field"
                        value={season}
                        onChange={(e) => setSeason(Number(e.target.value))}
                        style={{ width: "auto", minWidth: "4.5rem" }}
                      >
                        {seasons.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: "0.875rem" }}>
                      <span
                        className="muted"
                        style={{
                          display: "block",
                          marginBottom: "0.35rem",
                          fontSize: "0.7rem",
                          fontWeight: 650,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                        }}
                      >
                        Episode
                      </span>
                      <select
                        className="field"
                        value={episode}
                        onChange={(e) => setEpisode(Number(e.target.value))}
                        style={{ width: "auto", minWidth: "4.5rem" }}
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
                  <p className="text-danger" style={{ fontSize: "0.875rem", margin: 0 }}>
                    {streamError}
                  </p>
                )}
                {loadingStreams && (
                  <p className="stream-loading">
                    <span className="remux-spin" aria-hidden="true" />
                    Fetching streams from Comet…
                  </p>
                )}

                {streams.length > 0 && (
                  <div className="filters-box stack" style={{ gap: "0.75rem" }}>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                      }}
                    >
                      <span
                        className="muted"
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 650,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                        }}
                      >
                        Filters · {filteredStreams.length}/{streams.length}
                        {cachedCount > 0 ? ` · ${cachedCount} cached` : ""}
                      </span>
                      {(cacheFilter !== "all" ||
                        qualityFilter !== "all" ||
                        sortBy !== "quality") && (
                        <button
                          type="button"
                          className="text-accent"
                          style={{
                            background: "none",
                            border: 0,
                            cursor: "pointer",
                            font: "inherit",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            padding: 0,
                          }}
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
                      <p className="text-warn" style={{ fontSize: "0.75rem", margin: 0 }}>
                        Cache check failed: {cacheError}
                      </p>
                    )}
                    {!cacheError && cacheChecked && cachedCount === 0 && (
                      <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
                        TorBox reports 0 cached for these hashes.
                      </p>
                    )}
                    {!cacheError && !cacheChecked && (
                      <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
                        Set TorBox API key in Settings for cache badges.
                      </p>
                    )}

                    <div className="filter-groups">
                      <div>
                        <span className="filter-label">Cache</span>
                        <div className="chip-row">
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

                      <div>
                        <span className="filter-label">Resolution</span>
                        <div className="chip-row">
                          <button
                            type="button"
                            onClick={() => setQualityFilter("all")}
                            className={`chip ${qualityFilter === "all" ? "chip-active" : ""}`}
                          >
                            All
                          </button>
                          {qualityOptions.map((q) => {
                            const count = streams.filter(
                              (s) => s.quality === q,
                            ).length;
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

                      <div>
                        <span className="filter-label">Sort</span>
                        <div className="chip-row">
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
                  </div>
                )}

                <div className="stream-list">
                  {loadingStreams &&
                    [0, 1, 2, 3].map((i) => (
                      <div
                        key={`sk-${i}`}
                        className="stream-skeleton-card"
                        style={{ animationDelay: `${i * 0.12}s` }}
                      >
                        <div className="stream-skeleton-badges">
                          <span className="stream-skeleton-line" style={{ width: "3.2rem" }} />
                          <span className="stream-skeleton-line" style={{ width: "5.6rem" }} />
                          <span className="stream-skeleton-line" style={{ width: "2.6rem" }} />
                        </div>
                        <span className="stream-skeleton-line" style={{ width: "84%" }} />
                        <span className="stream-skeleton-line" style={{ width: "56%" }} />
                      </div>
                    ))}
                  {filteredStreams.map((s) => {
                    const isPicked =
                      picked?.infoHash === s.infoHash &&
                      picked.title === s.title;
                    return (
                      <button
                        key={`${s.infoHash}-${s.title}`}
                        type="button"
                        onClick={() => setPicked(s)}
                        className={`stream-item${isPicked ? " is-active" : ""}`}
                      >
                        <div className="stream-badges">
                          <span
                            className="badge"
                            style={{
                              background: "var(--line)",
                              color: "var(--ink-soft)",
                            }}
                          >
                            {s.quality}
                          </span>
                          {s.cached && (
                            <span
                              className="badge"
                              style={{
                                background: "var(--accent-soft)",
                                color: "var(--accent)",
                              }}
                            >
                              TorBox cached
                            </span>
                          )}
                          {s.packHint && (
                            <span
                              className="badge"
                              style={{
                                background: "rgba(183,148,246,0.15)",
                                color: "var(--violet)",
                              }}
                            >
                              {s.packHint}
                            </span>
                          )}
                          {s.size && <span className="muted">{s.size}</span>}
                        </div>
                        <div
                          className="muted"
                          style={{
                            marginTop: "0.4rem",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {s.title}
                        </div>
                      </button>
                    );
                  })}
                  {!loadingStreams &&
                    streams.length > 0 &&
                    filteredStreams.length === 0 && (
                      <p className="muted" style={{ fontSize: "0.875rem" }}>
                        No streams match filters.
                      </p>
                    )}
                  {!loadingStreams &&
                    streams.length === 0 &&
                    selected.type === "movie" && (
                      <p className="muted" style={{ fontSize: "0.875rem" }}>
                        No streams found.
                      </p>
                    )}
                </div>

              </>
            )}

            {selected && picked && (
              <div className="download-bar">
                <div className="download-bar-row">
                  <div className="name-mode">
                    <label>
                      <input
                        type="radio"
                        checked={useAutoName}
                        onChange={() => setUseAutoName(true)}
                      />
                      Auto
                    </label>
                    <label>
                      <input
                        type="radio"
                        checked={!useAutoName}
                        onChange={() => setUseAutoName(false)}
                      />
                      Custom
                    </label>
                  </div>
                  <input
                    className="field download-name"
                    value={useAutoName ? autoPreview : customName}
                    onChange={(e) => {
                      setUseAutoName(false);
                      setCustomName(e.target.value);
                    }}
                    placeholder="Ant Man (2015) - 1080p.mkv"
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={downloading}
                    onClick={() => void startDownload()}
                  >
                    {downloading
                      ? "Starting…"
                      : picked.packHint && selected.type === "series"
                        ? "Download pack"
                        : "Download"}
                  </button>
                </div>
                {pathPreview && <p className="download-path">→ {pathPreview}</p>}
                {picked.packHint && selected.type === "series" && (
                  <p className="download-note text-violet">
                    Pack detected ({picked.packHint}). All episodes will be saved
                    into the right Season folders.
                  </p>
                )}
                {ownedEpisode && (
                  <p className="download-note text-warn">
                    This episode already exists in your library.
                  </p>
                )}
                {downloadMsg && (
                  <p className="download-note muted">{downloadMsg}</p>
                )}
              </div>
            )}
          </div>
        </section>
          </>
        )}
      </div>
    </div>
  );
}
