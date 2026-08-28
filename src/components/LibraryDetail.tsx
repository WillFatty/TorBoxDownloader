
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MediaMeta, MediaRatings } from "@/lib/types";
import type { RemuxLogEntry } from "@/lib/remux-progress";
import {
  hueStyle,
  readJson,
  tileInitials,
  type ArtworkEntry,
  type LibSelection,
  type LibShow,
  type MediaLanguages,
  type NamingIssue,
} from "./LibraryShared";

const RESOLUTION = /\b(2160p|1080p|720p|480p|4k)\b/i;

const REMUX_ENDPOINT = {
  "en-only": "/api/library/english-only",
  "en-subs": "/api/library/english-subs",
} as const;

const REMUX_LABEL = {
  "en-only": "Remuxing to English only",
  "en-subs": "Removing non-English subtitles",
} as const;

function isEnglishCode(code: string): boolean {
  const base = code.toLowerCase().split("-")[0];
  return base === "en" || base === "eng";
}

function needsEnglishOnly(langs: MediaLanguages | undefined): boolean {
  if (!langs?.audio?.length) return false;
  return langs.audio.some((a) => !isEnglishCode(a.code));
}

function needsEnglishSubsOnly(langs: MediaLanguages | undefined): boolean {
  if (!langs?.subtitles?.length) return false;
  return langs.subtitles.some((s) => !isEnglishCode(s.code));
}

function IconRefresh({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M20 12a8 8 0 1 1-2.2-5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 4v5h-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRemux({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 7h10M14 7l-3-3M14 7l-3 3M20 17H10M10 17l3-3M10 17l3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LangTags({
  langs,
  resolution,
  onEnglishOnly,
  onEnglishSubs,
  busy,
  remuxing,
}: {
  langs: MediaLanguages | undefined;
  resolution: string | null;
  onEnglishOnly?: () => void;
  onEnglishSubs?: () => void;
  busy?: boolean;
  remuxing?: number | null;
}) {
  const audio = langs?.audio || [];
  const subs = langs?.subtitles || [];
  const showEn = Boolean(onEnglishOnly && needsEnglishOnly(langs));
  const showSubs = Boolean(
    onEnglishSubs && needsEnglishSubsOnly(langs) && !showEn,
  );
  if (
    !resolution &&
    !audio.length &&
    !subs.length &&
    !showEn &&
    !showSubs &&
    remuxing == null
  ) {
    return null;
  }

  return (
    <span className="lib-detail-meta">
      <span className="lib-detail-tags">
        {resolution && <span className="lib-detail-tag">{resolution}</span>}
        {audio.map((lang) => (
          <span
            key={`a-${lang.code}`}
            className="lib-detail-tag is-audio"
            title={`Audio: ${lang.label}`}
          >
            {lang.code.toUpperCase()}
          </span>
        ))}
        {subs.map((lang) => (
          <span
            key={`s-${lang.code}`}
            className="lib-detail-tag is-sub"
            title={`Subtitles: ${lang.label}`}
          >
            {lang.code.toUpperCase()} sub
          </span>
        ))}
      </span>
      {remuxing != null ? (
        <span
          className="lib-detail-tag is-remuxing"
          title="This file is currently being remuxed"
        >
          <span className="remux-spin" aria-hidden="true" />
          {remuxing > 0 ? `Remuxing ${remuxing}%` : "Remuxing…"}
        </span>
      ) : (
        (showEn || showSubs) && (
          <span className="lib-detail-row-actions">
            {showEn && (
              <button
                type="button"
                className="lib-action lib-action-sm"
                disabled={busy}
                title="Remux file to keep English audio and subtitles only"
                onClick={(e) => {
                  e.stopPropagation();
                  onEnglishOnly?.();
                }}
              >
                <IconRemux size={12} />
                {busy ? "…" : "EN only"}
              </button>
            )}
            {showSubs && (
              <button
                type="button"
                className="lib-action lib-action-sm"
                disabled={busy}
                title="Remux file to keep English subtitles only (audio untouched)"
                onClick={(e) => {
                  e.stopPropagation();
                  onEnglishSubs?.();
                }}
              >
                <IconRemux size={12} />
                {busy ? "…" : "EN subs"}
              </button>
            )}
          </span>
        )
      )}
    </span>
  );
}

function NamingIssuesPanel({
  issues,
  type,
  folder,
  canonicalName,
  canonicalYear,
  episodeTitles,
  onFixed,
}: {
  issues: NamingIssue[];
  type: "movie" | "series";
  folder: string;
  canonicalName: string;
  canonicalYear: string | null;
  episodeTitles: Record<string, string>;
  onFixed: (result: { newFolder: string; changes: Array<{ from: string; to: string }> }) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fixableIssues = issues.filter(
    (issue) => issue.code !== "unmatched" && Boolean(issue.expected),
  );

  if (!issues.length) return null;

  async function runFix(body: Record<string, unknown>) {
    const res = await fetch("/api/library/fix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await readJson<{
      error?: string;
      newFolder?: string;
      changes?: Array<{ from: string; to: string }>;
    }>(res);
    if (!res.ok) throw new Error(data.error || "Fix failed");
    return {
      newFolder: data.newFolder || folder,
      changes: data.changes || [],
    };
  }

  async function fixIssue(issue: NamingIssue) {
    if (issue.code === "unmatched" || !issue.expected) return;

    const key = `${issue.code}-${issue.file || ""}`;
    setBusyKey(key);
    setError(null);
    try {
      const result = await runFix({
        type,
        folder,
        issueCode: issue.code,
        file: issue.file,
        canonicalName,
        canonicalYear,
        episodeTitles,
      });
      onFixed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fix failed");
    } finally {
      setBusyKey(null);
    }
  }

  async function fixAll() {
    if (!fixableIssues.length) return;

    setBusyKey("all");
    setError(null);
    try {
      const result = await runFix({
        type,
        folder,
        fixAll: true,
        canonicalName,
        canonicalYear,
        episodeTitles,
        issues: fixableIssues.map((issue) => ({
          issueCode: issue.code,
          file: issue.file,
        })),
      });
      onFixed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fix failed");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="lib-naming-issues">
      <div className="lib-naming-head">
        <h3 className="lib-naming-title">Naming issues</h3>
        {fixableIssues.length > 0 && (
          <button
            type="button"
            className="btn-secondary lib-naming-fix-all"
            disabled={Boolean(busyKey)}
            onClick={() => void fixAll()}
          >
            {busyKey === "all" ? "Fixing all…" : "Fix all"}
          </button>
        )}
      </div>
      {error && <p className="lib-naming-error">{error}</p>}
      <ul className="lib-naming-list">
        {issues.map((issue, index) => {
          const fixable = issue.code !== "unmatched" && Boolean(issue.expected);
          const key = `${issue.code}-${issue.file || index}`;
          const busy = busyKey === `${issue.code}-${issue.file || ""}`;
          return (
            <li
              key={key}
              className={`lib-naming-issue is-${issue.severity}`}
            >
              <div className="lib-naming-issue-head">
                <span className="lib-naming-scope">
                  {issue.scope === "folder" ? "Folder" : "File"}
                </span>
                {fixable && (
                  <button
                    type="button"
                    className="btn-secondary lib-naming-fix"
                    disabled={Boolean(busyKey)}
                    onClick={() => void fixIssue(issue)}
                  >
                    {busy ? "Fixing…" : "Fix"}
                  </button>
                )}
              </div>
              <p className="lib-naming-message">{issue.message}</p>
              {issue.expected && (
                <p className="lib-naming-diff">
                  Expected <code>{issue.expected}</code>
                  {issue.actual ? (
                    <>
                      {" "}
                      · got <code>{issue.actual}</code>
                    </>
                  ) : null}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function resolutionOf(fileName: string): string | null {
  const hit = fileName.match(RESOLUTION);
  return hit ? hit[1].toUpperCase().replace("4K", "2160P") : null;
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

export function LibraryDetail({
  selection,
  art,
  onClose,
  onFixed,
  jellyfinConfigured = false,
}: {
  selection: LibSelection;
  art: ArtworkEntry | undefined;
  onClose: () => void;
  onFixed: (oldFolder: string, result: { newFolder: string }) => void;
  jellyfinConfigured?: boolean;
}) {
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const [ratings, setRatings] = useState<MediaRatings | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [langs, setLangs] = useState<Record<string, MediaLanguages>>({});
  const [enBusy, setEnBusy] = useState<string | null>(null);
  const [enStatus, setEnStatus] = useState<string | null>(null);
  const [enError, setEnError] = useState<string | null>(null);
  const [jfBusy, setJfBusy] = useState(false);
  const [jfStatus, setJfStatus] = useState<string | null>(null);
  const [jfError, setJfError] = useState<string | null>(null);
  const remuxPollRef = useRef<(() => void) | null>(null);

  const isShow = selection.kind === "show";
  const name = isShow ? selection.show.name : selection.movie.name;
  const folder = isShow ? selection.show.folder : selection.movie.folder;
  const imdbId = art?.imdbId ?? null;
  const poster = art?.poster ?? null;

  const probeFiles = useMemo(() => {
    if (selection.kind === "movie") {
      return selection.movie.files.map((file) =>
        folder.endsWith("/") || folder.endsWith("\\")
          ? `${folder}${file}`
          : `${folder}/${file}`.replace(/\/+/g, "/"),
      );
    }
    return selection.show.episodes
      .map((ep) => ep.path)
      .filter((p): p is string => Boolean(p));
  }, [selection, folder]);

  useEffect(() => {
    if (!probeFiles.length) {
      setLangs({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const BATCH = 40;
      const merged: Record<string, MediaLanguages> = {};
      for (let i = 0; i < probeFiles.length; i += BATCH) {
        if (cancelled) return;
        try {
          const res = await fetch("/api/library/probe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              files: probeFiles.slice(i, i + BATCH),
            }),
          });
          if (!res.ok) continue;
          const data = await readJson<{
            languages?: Record<string, MediaLanguages>;
          }>(res);
          Object.assign(merged, data.languages || {});
          if (!cancelled) setLangs({ ...merged });
        } catch {
          // Language tags are optional.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [probeFiles]);

  function langsFor(filePath: string | undefined): MediaLanguages | undefined {
    if (!filePath) return undefined;
    if (langs[filePath]) return langs[filePath];
    const normalized = filePath.replace(/\\/g, "/");
    if (langs[normalized]) return langs[normalized];
    // Match on basename if absolute keys differ slightly across resolve().
    const base = normalized.split("/").pop();
    if (!base) return undefined;
    for (const [key, value] of Object.entries(langs)) {
      if (key.replace(/\\/g, "/").endsWith(`/${base}`)) return value;
    }
    return undefined;
  }

  const refreshLangs = useCallback(async function (files: string[]) {
    if (!files.length) return;
    try {
      const res = await fetch("/api/library/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      if (!res.ok) return;
      const data = await readJson<{
        languages?: Record<string, MediaLanguages>;
      }>(res);
      setLangs((prev) => ({ ...prev, ...(data.languages || {}) }));
    } catch {
      // optional
    }
  }, []);

  const [activeRemux, setActiveRemux] = useState<Record<string, number>>({});
  const prevActiveRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch("/api/remux");
        if (!res.ok || cancelled) return;
        const data = await readJson<{ entries?: RemuxLogEntry[] }>(res);
        if (cancelled) return;
        const active: Record<string, number> = {};
        for (const entry of data.entries || []) {
          if (entry.status === "queued" || entry.status === "working") {
            active[entry.file] = entry.percent;
          }
        }
        setActiveRemux(active);

        const finished = [...prevActiveRef.current].filter(
          (p) => !(p in active),
        );
        prevActiveRef.current = new Set(Object.keys(active));
        const relevant = finished.filter((p) =>
          probeFiles.some((f) =>
            f
              .replace(/\\/g, "/")
              .endsWith(`/${p.replace(/\\/g, "/").split("/").pop()}`),
          ),
        );
        if (relevant.length) void refreshLangs(relevant);
      } catch {
        // Progress polling is best-effort.
      }
    }

    void tick();
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [probeFiles, refreshLangs]);

  function activePercentFor(filePath: string | undefined): number | null {
    if (!filePath) return null;
    if (filePath in activeRemux) return activeRemux[filePath];
    const normalized = filePath.replace(/\\/g, "/");
    if (normalized in activeRemux) return activeRemux[normalized];
    const base = normalized.split("/").pop() || "";
    for (const [key, percent] of Object.entries(activeRemux)) {
      if (key.replace(/\\/g, "/").endsWith(`/${base}`)) return percent;
    }
    return null;
  }

  async function runRemux(
    kind: "en-only" | "en-subs",
    files: string[],
  ) {
    const needs =
      kind === "en-only" ? needsEnglishOnly : needsEnglishSubsOnly;
    const targets = files.filter((f) => needs(langsFor(f)));
    if (!targets.length) {
      setEnStatus(kind === "en-only" ? "Already English-only" : "Subtitles already English");
      return;
    }

    if (targets.length > 1) {
      const what =
        kind === "en-only"
          ? "English audio & subtitles only"
          : "keep English subtitles only (audio untouched)";
      const ok = window.confirm(
        `Remux ${targets.length} files to ${what}?\n\nVideo is stream-copied (not re-encoded). Unwanted tracks are removed in place.`,
      );
      if (!ok) return;
    }

    const endpoint = REMUX_ENDPOINT[kind];

    setEnError(null);
    setEnStatus(null);
    setEnBusy(targets[0]);

    // Hand the batch to the server queue and return immediately — ffmpeg runs
    // in the background so the request can't hit gateway timeouts (504s).
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: targets }),
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Remux failed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Remux failed";
      setEnBusy(null);
      setEnStatus(null);
      setEnError(message);
      return;
    }

    let missedTicks = 0;
    let failureSummary: string | null = null;

    await new Promise<void>((resolve) => {
      const poll = window.setInterval(() => {
        void (async () => {
          try {
            const res = await fetch(
              `${endpoint}?files=${encodeURIComponent(JSON.stringify(targets))}`,
            );
            if (!res.ok) return;
            const data = await readJson<{
              progress?: Record<
                string,
                { status?: string; percent?: number; error?: string }
              >;
            }>(res);
            const progress = data.progress;
            if (!progress) return;

            const tracked = targets.filter((t) => progress[t]);
            const timedOut = !tracked.length && ++missedTicks >= 15;
            if (!timedOut && tracked.length) missedTicks = 0;
            if (!tracked.length && !timedOut) return;

            const allTerminal = targets.every((t) => {
              const status = progress[t]?.status;
              return (
                status === "done" ||
                status === "skipped" ||
                status === "failed"
              );
            });
            const finished = timedOut || allTerminal;

            const failedNow = targets.filter(
              (t) => progress[t]?.status === "failed",
            );
            if (failedNow.length) {
              const first = failedNow[0];
              const reason = progress[first]?.error || "Remux failed";
              failureSummary =
                failedNow.length > 1
                  ? `${reason} (${failedNow.length} files failed)`
                  : reason;
            } else if (timedOut && !failureSummary) {
              failureSummary =
                "Lost contact with the remux queue (server may have restarted)";
            }

            if (finished) {
              window.clearInterval(poll);
              resolve();
            }
          } catch {
            // Progress polling is best-effort.
          }
        })();
      }, 700);
      remuxPollRef.current = () => {
        window.clearInterval(poll);
        resolve();
      };
    });
    remuxPollRef.current = null;

    void refreshLangs(targets);
    setEnBusy(null);

    if (failureSummary) {
      setEnStatus(null);
      setEnError(failureSummary);
    } else {
      setEnStatus(
        targets.length === 1
          ? `${REMUX_LABEL[kind]} — complete`
          : `${REMUX_LABEL[kind]} — complete (${targets.length} files)`,
      );
    }
  }

  async function refreshJfMetadata() {
    if (!probeFiles.length) return;
    setJfBusy(true);
    setJfStatus(null);
    setJfError(null);
    try {
      const res = await fetch("/api/jellyfin/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: isShow ? "series" : "movie",
          paths: probeFiles,
        }),
      });
      const data = await readJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Metadata refresh failed");
      setJfStatus("Metadata refresh requested — Jellyfin is updating this item.");
    } catch (err) {
      setJfError(err instanceof Error ? err.message : "Metadata refresh failed");
    } finally {
      setJfBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      remuxPollRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!imdbId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/meta?type=${isShow ? "series" : "movie"}&id=${encodeURIComponent(imdbId)}`,
        );
        if (!res.ok) return;
        const data = await readJson<{ meta?: MediaMeta }>(res);
        if (!cancelled && data.meta) setMeta(data.meta);
      } catch {
        // Synopsis and episode titles are a bonus; the file list stands alone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imdbId, isShow]);

  useEffect(() => {
    if (!imdbId) {
      setRatings(null);
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/ratings?type=${isShow ? "series" : "movie"}&id=${encodeURIComponent(imdbId)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.ratings) setRatings(d.ratings as MediaRatings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [imdbId, isShow]);

  const seasonGroups = useMemo(
    () => (isShow ? groupBySeason(selection.show.episodes) : []),
    [isShow, selection],
  );

  const activeSeason =
    season ?? seasonGroups[0]?.season ?? null;
  const activeGroup =
    seasonGroups.find((g) => g.season === activeSeason) ?? seasonGroups[0];

  const showPaths = useMemo(
    () =>
      isShow
        ? [
            ...new Set(
              seasonGroups.flatMap((g) =>
                g.eps
                  .map((ep) => ep.path)
                  .filter((p): p is string => Boolean(p)),
              ),
            ),
          ]
        : [],
    [isShow, seasonGroups],
  );
  const showRemuxActive = Boolean(
    showPaths.some((p) => activePercentFor(p) !== null),
  );
  const movieRemuxActive = probeFiles.some(
    (p) => activePercentFor(p) !== null,
  );
  const seasonPaths = useMemo(
    () =>
      (activeGroup?.eps || [])
        .map((ep) => ep.path)
        .filter((p): p is string => Boolean(p)),
    [activeGroup],
  );
  const needsAllEn =
    isShow && showPaths.some((p) => needsEnglishOnly(langsFor(p)));
  const needsAllSubs =
    isShow && showPaths.some((p) => needsEnglishSubsOnly(langsFor(p)));
  const needsSeasonEn = seasonPaths.some((p) => needsEnglishOnly(langsFor(p)));
  const needsSeasonSubs = seasonPaths.some((p) =>
    needsEnglishSubsOnly(langsFor(p)),
  );
  const needsMovieEn = !isShow && probeFiles.some((p) => needsEnglishOnly(langsFor(p)));
  const needsMovieSubs =
    !isShow && probeFiles.some((p) => needsEnglishSubsOnly(langsFor(p)));
  const remuxBusy = Boolean(enBusy) || showRemuxActive || movieRemuxActive;
  const hasBulkRemux =
    showRemuxActive ||
    movieRemuxActive ||
    (isShow
      ? (seasonGroups.length > 1 && (needsAllEn || needsAllSubs)) ||
        needsSeasonEn ||
        needsSeasonSubs
      : needsMovieEn || needsMovieSubs);
  const showToolbar =
    jellyfinConfigured ||
    hasBulkRemux ||
    Boolean(jfStatus || jfError || enStatus || enError);

  // Cinemeta episode titles, keyed so local files can borrow them.
  const episodeTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const video of meta?.videos || []) {
      map.set(`${video.season}:${video.episode}`, video.title);
    }
    return map;
  }, [meta]);

  const year = isShow ? meta?.year || "" : selection.movie.year || meta?.year || "";
  const facts = isShow
    ? [
        `${selection.show.seasons.length} season${selection.show.seasons.length === 1 ? "" : "s"}`,
        `${selection.show.episodeCount} episode${selection.show.episodeCount === 1 ? "" : "s"}`,
      ]
    : [
        `${selection.movie.fileCount} file${selection.movie.fileCount === 1 ? "" : "s"}`,
      ];
  if (meta?.runtime) facts.push(meta.runtime);

  if (typeof document === "undefined") return null;

  // Portalled to <body> because the page shell keeps a transform from its
  // entry animation, which would otherwise make `position: fixed` resolve
  // against the shell instead of the viewport.
  return (
    <>
      {createPortal(
        <div
          className="lib-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={name}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="lib-modal">
            <button
              type="button"
              className="lib-modal-close"
              aria-label="Close"
              onClick={onClose}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M5 5 19 19 M19 5 5 19"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>

            <div className="lib-hero" style={hueStyle(name)}>
              {meta?.background && (
                <img src={meta.background} alt="" className="lib-hero-img" />
              )}
              <div className="lib-hero-fade" />
              <div className="lib-hero-content">
                <span className="lib-hero-poster">
                  {poster ? (
                    <img src={poster} alt="" className="lib-art-img" />
                  ) : (
                    <span className="lib-tile" style={hueStyle(name)}>
                      {tileInitials(name)}
                    </span>
                  )}
                </span>
                <div className="lib-hero-text">
                  <h2 className="lib-hero-title">{name}</h2>
                  <div className="lib-hero-facts">
                    {year && <span className="lib-fact is-year">{year}</span>}
                    {facts.map((fact) => (
                      <span key={fact} className="lib-fact">
                        {fact}
                      </span>
                    ))}
                  </div>
                  {ratings?.scores.length ? (
                    <div className="score-row lib-hero-ratings">
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
                    <p className="score-summary lib-hero-summary">
                      {ratings.summary}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="lib-modal-body">
              {meta?.genres?.length ? (
                <div className="lib-genres">
                  {meta.genres.slice(0, 5).map((genre) => (
                    <span key={genre} className="chip">
                      {genre}
                    </span>
                  ))}
                </div>
              ) : null}

              {meta?.description && (
                <p className="lib-overview">{meta.description}</p>
              )}

              {art?.namingIssues?.length ? (
                <NamingIssuesPanel
                  issues={art.namingIssues}
                  type={isShow ? "series" : "movie"}
                  folder={folder}
                  canonicalName={art.canonicalName || name}
                  canonicalYear={
                    isShow ? null : art.canonicalYear || selection.movie.year
                  }
                  episodeTitles={Object.fromEntries(episodeTitles)}
                  onFixed={(result) =>
                    onFixed(folder, { newFolder: result.newFolder })
                  }
                />
              ) : null}

              {art?.canonicalName &&
                !isShow &&
                (art.canonicalName !== name ||
                  (art.canonicalYear && art.canonicalYear !== year)) && (
                  <p className="lib-canonical-hint">
                    Identified as{" "}
                    <strong>
                      {art.canonicalName}
                      {art.canonicalYear ? ` (${art.canonicalYear})` : ""}
                    </strong>
                  </p>
                )}

              {art?.canonicalName && isShow && art.canonicalName !== name && (
                <p className="lib-canonical-hint">
                  Identified as <strong>{art.canonicalName}</strong>
                </p>
              )}

              {isShow && activeGroup && seasonGroups.length > 1 && (
                <div className="lib-season-tabs">
                  {seasonGroups.map((group) => (
                    <button
                      key={group.season}
                      type="button"
                      className={`chip${group.season === activeGroup.season ? " chip-active" : ""}`}
                      onClick={() => setSeason(group.season)}
                    >
                      {group.season === 0
                        ? "Specials"
                        : `Season ${group.season}`}
                      <span className="lib-season-count">
                        {group.eps.length}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {showToolbar && (
                <div className="lib-modal-toolbar">
                  <div className="lib-modal-actions">
                    {jellyfinConfigured && (
                      <button
                        type="button"
                        className="lib-action"
                        disabled={jfBusy || !probeFiles.length}
                        title="Ask Jellyfin to re-read metadata and images for this item only"
                        onClick={() => void refreshJfMetadata()}
                      >
                        {jfBusy ? (
                          <span className="remux-spin" aria-hidden="true" />
                        ) : (
                          <IconRefresh />
                        )}
                        {jfBusy ? "Refreshing…" : "Refresh metadata"}
                      </button>
                    )}

                    {(showRemuxActive || movieRemuxActive) && (
                      <span className="lib-detail-tag is-remuxing">
                        <span className="remux-spin" aria-hidden="true" />
                        Remuxing…
                      </span>
                    )}

                    {!showRemuxActive &&
                      !movieRemuxActive &&
                      isShow &&
                      seasonGroups.length > 1 &&
                      needsAllEn && (
                        <button
                          type="button"
                          className="lib-action"
                          disabled={remuxBusy}
                          title="Remux every episode to keep English audio and subtitles only"
                          onClick={() => void runRemux("en-only", showPaths)}
                        >
                          <IconRemux />
                          {enBusy ? "Remuxing…" : "EN only · all"}
                        </button>
                      )}
                    {!showRemuxActive &&
                      !movieRemuxActive &&
                      isShow &&
                      seasonGroups.length > 1 &&
                      needsAllSubs && (
                        <button
                          type="button"
                          className="lib-action"
                          disabled={remuxBusy}
                          title="Remux every episode to keep English subtitles only"
                          onClick={() => void runRemux("en-subs", showPaths)}
                        >
                          <IconRemux />
                          {enBusy ? "Remuxing…" : "EN subs · all"}
                        </button>
                      )}
                    {!showRemuxActive && isShow && needsSeasonEn && (
                      <button
                        type="button"
                        className="lib-action"
                        disabled={remuxBusy}
                        title="Remux this season to keep English audio and subtitles only"
                        onClick={() => void runRemux("en-only", seasonPaths)}
                      >
                        <IconRemux />
                        {enBusy ? "Remuxing…" : "EN only · season"}
                      </button>
                    )}
                    {!showRemuxActive && isShow && needsSeasonSubs && (
                      <button
                        type="button"
                        className="lib-action"
                        disabled={remuxBusy}
                        title="Remux this season to keep English subtitles only"
                        onClick={() => void runRemux("en-subs", seasonPaths)}
                      >
                        <IconRemux />
                        {enBusy ? "Remuxing…" : "EN subs · season"}
                      </button>
                    )}
                    {!movieRemuxActive && needsMovieEn && (
                      <button
                        type="button"
                        className="lib-action"
                        disabled={remuxBusy}
                        title="Remux to keep English audio and subtitles only"
                        onClick={() => void runRemux("en-only", probeFiles)}
                      >
                        <IconRemux />
                        {enBusy ? "Remuxing…" : "English only"}
                      </button>
                    )}
                    {!movieRemuxActive && needsMovieSubs && (
                      <button
                        type="button"
                        className="lib-action"
                        disabled={remuxBusy}
                        title="Remux to keep English subtitles only"
                        onClick={() => void runRemux("en-subs", probeFiles)}
                      >
                        <IconRemux />
                        {enBusy ? "Remuxing…" : "English subs"}
                      </button>
                    )}
                  </div>
                  {(jfStatus || jfError || enStatus || enError) && (
                    <p
                      className={
                        jfError || enError
                          ? "lib-naming-error"
                          : "lib-en-status"
                      }
                    >
                      {jfError || enError || jfStatus || enStatus}
                    </p>
                  )}
                </div>
              )}

              {isShow && activeGroup ? (
                <ul className="lib-detail-list">
                  {activeGroup.eps.map((ep) => {
                    const title = episodeTitles.get(
                      `${ep.season}:${ep.episode}`,
                    );
                    const res = resolutionOf(ep.fileName);
                    return (
                      <li
                        key={`${ep.season}-${ep.episode}-${ep.fileName}`}
                        className="lib-detail-row"
                      >
                        <span className="lib-detail-num">
                          {String(ep.episode).padStart(2, "0")}
                        </span>
                        <span className="lib-detail-text">
                          <span className="lib-detail-title">
                            {title || ep.fileName}
                          </span>
                          {title && (
                            <span className="lib-detail-file">
                              {ep.fileName}
                            </span>
                          )}
                        </span>
                        <LangTags
                          langs={langsFor(ep.path)}
                          resolution={res}
                          busy={Boolean(enBusy)}
                          remuxing={activePercentFor(ep.path)}
                          onEnglishOnly={
                            ep.path
                              ? () => void runRemux("en-only", [ep.path!])
                              : undefined
                          }
                          onEnglishSubs={
                            ep.path
                              ? () => void runRemux("en-subs", [ep.path!])
                              : undefined
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {!isShow && (
                <ul className="lib-detail-list">
                  {selection.movie.files.map((file) => {
                    const res = resolutionOf(file);
                    const filePath = probeFiles.find(
                      (p) =>
                        p.endsWith(`/${file}`) ||
                        p.endsWith(`\\${file}`) ||
                        p.endsWith(file),
                    );
                    return (
                      <li key={file} className="lib-detail-row">
                        <span className="lib-detail-text">
                          <span className="lib-detail-title">{file}</span>
                        </span>
                        <LangTags
                          langs={langsFor(filePath)}
                          resolution={res}
                          busy={Boolean(enBusy)}
                          remuxing={activePercentFor(filePath)}
                          onEnglishOnly={
                            filePath
                              ? () => void runRemux("en-only", [filePath])
                              : undefined
                          }
                          onEnglishSubs={
                            filePath
                              ? () => void runRemux("en-subs", [filePath])
                              : undefined
                          }
                        />
                      </li>
                    );
                  })}
                  {!selection.movie.files.length && (
                    <li className="lib-detail-row muted">
                      No video files in this folder.
                    </li>
                  )}
                </ul>
              )}
            </div>

            <div className="lib-modal-foot">
              <code>{folder}</code>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
