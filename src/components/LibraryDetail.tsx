"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MediaMeta } from "@/lib/types";
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

type RemuxItemStatus =
  | "pending"
  | "working"
  | "done"
  | "failed"
  | "skipped";

interface RemuxItem {
  path: string;
  name: string;
  status: RemuxItemStatus;
  percent: number;
}

interface RemuxSession {
  kind: "en-only" | "en-subs";
  title: string;
  items: RemuxItem[];
  error: string | null;
  running: boolean;
}

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
      {remuxing != null ? (
        <span
          className="lib-detail-tag is-remuxing"
          title="This file is currently being remuxed"
        >
          <span className="remux-spin" aria-hidden="true" />
          {remuxing > 0 ? `Remuxing ${remuxing}%` : "Remuxing…"}
        </span>
      ) : (
        <>
          {showEn && (
            <button
              type="button"
              className="btn-secondary lib-en-btn"
              disabled={busy}
              title="Remux file to keep English audio and subtitles only"
              onClick={(e) => {
                e.stopPropagation();
                onEnglishOnly?.();
              }}
            >
              {busy ? "…" : "EN only"}
            </button>
          )}
          {showSubs && (
            <button
              type="button"
              className="btn-secondary lib-en-btn"
              disabled={busy}
              title="Remux file to keep English subtitles only (audio untouched)"
              onClick={(e) => {
                e.stopPropagation();
                onEnglishSubs?.();
              }}
            >
              {busy ? "…" : "EN subs"}
            </button>
          )}
        </>
      )}
    </span>
  );
}

function RemuxProgressModal({
  session,
  onClose,
}: {
  session: RemuxSession;
  onClose: () => void;
}) {
  const total = session.items.length;
  const finished = session.items.filter(
    (item) => item.status === "done" || item.status === "failed",
  ).length;
  const percent = total
    ? Math.round(
        session.items.reduce((sum, item) => sum + item.percent, 0) / total,
      )
    : 0;

  return createPortal(
    <div
      className="lib-modal-backdrop remux-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={REMUX_LABEL[session.kind]}
      onClick={(e) => {
        if (e.target === e.currentTarget && !session.running) onClose();
      }}
    >
      <div className="remux-modal">
        <h3 className="remux-title">{REMUX_LABEL[session.kind]}</h3>
        <p className="remux-sub">{session.title}</p>

        <div className="remux-progress">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="remux-count">{percent}%</span>
        </div>
        {total > 1 && (
          <p className="remux-phase">
            {finished}/{total} files · {session.running ? "in progress" : "finished"}
          </p>
        )}

        {session.error && (
          <p className="lib-naming-error">{session.error}</p>
        )}

        <ul className="remux-files">
          {session.items.map((item) => (
            <li key={item.path} className={`remux-file is-${item.status}`}>
              <span className="remux-file-icon" aria-hidden="true">
                {item.status === "done" ? (
                  "✓"
                ) : item.status === "failed" ? (
                  "✕"
                ) : item.status === "working" ? (
                  <span className="remux-spin" />
                ) : null}
              </span>
              <span className="remux-file-name">{item.name}</span>
              {item.status === "working" && item.percent > 0 && (
                <span className="remux-file-bar">
                  <span
                    className="remux-file-fill"
                    style={{ width: `${item.percent}%` }}
                  />
                </span>
              )}
              <span className="remux-file-state">
                {item.status === "pending"
                  ? "Queued"
                  : item.status === "working"
                    ? item.percent > 0
                      ? `${item.percent}%`
                      : "Remuxing…"
                    : item.status === "done"
                      ? "Done"
                      : item.status === "skipped"
                        ? "Skipped"
                        : "Failed"}
              </span>
            </li>
          ))}
        </ul>

        {!session.running && (
          <button
            type="button"
            className="btn-secondary remux-close"
            onClick={onClose}
          >
            Close
          </button>
        )}
      </div>
    </div>,
    document.body,
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
  const [season, setSeason] = useState<number | null>(null);
  const [langs, setLangs] = useState<Record<string, MediaLanguages>>({});
  const [enBusy, setEnBusy] = useState<string | null>(null);
  const [enStatus, setEnStatus] = useState<string | null>(null);
  const [enError, setEnError] = useState<string | null>(null);
  const [remux, setRemux] = useState<RemuxSession | null>(null);
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
    setRemux({
      kind,
      title: name,
      items: targets.map((file) => ({
        path: file,
        name: file.replace(/\\/g, "/").split("/").pop() || file,
        status: "pending",
        percent: 0,
      })),
      error: null,
      running: true,
    });
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
      setRemux((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                item.status === "pending" || item.status === "working"
                  ? { ...item, status: "failed" }
                  : item,
              ),
              error: message,
              running: false,
            }
          : prev,
      );
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

            setRemux((prev) => {
              if (!prev?.running) return prev;
              const items = prev.items.map((item) => {
                if (
                  item.status === "done" ||
                  item.status === "failed" ||
                  item.status === "skipped"
                ) {
                  return item;
                }
                if (timedOut && !progress[item.path]) {
                  return { ...item, status: "failed" as const, percent: 100 };
                }
                const entry = progress[item.path];
                if (!entry) return item;
                if (
                  entry.status === "done" ||
                  entry.status === "skipped" ||
                  entry.status === "failed"
                ) {
                  return {
                    ...item,
                    status: entry.status as RemuxItemStatus,
                    percent: 100,
                  };
                }
                const remotePercent = Math.max(0, entry.percent ?? 0);
                if (
                  remotePercent > item.percent ||
                  (remotePercent > 0 && item.status === "pending")
                ) {
                  return {
                    ...item,
                    status: "working" as const,
                    percent: Math.max(item.percent, remotePercent),
                  };
                }
                return item;
              });
              return { ...prev, items };
            });

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
    setRemux((prev) => (prev ? { ...prev, running: false } : prev));

    if (failureSummary) {
      setEnStatus(null);
      setEnError(failureSummary);
      setRemux((prev) => (prev ? { ...prev, error: failureSummary } : prev));
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
      if (!remux) {
        onClose();
        return;
      }
      if (!remux.running) setRemux(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, remux]);

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

  const seasonGroups = useMemo(
    () => (isShow ? groupBySeason(selection.show.episodes) : []),
    [isShow, selection],
  );

  const activeSeason =
    season ?? seasonGroups[0]?.season ?? null;
  const activeGroup =
    seasonGroups.find((g) => g.season === activeSeason) ?? seasonGroups[0];

  const seasonRemuxActive = Boolean(
    activeGroup?.eps.some(
      (ep) => ep.path && activePercentFor(ep.path) !== null,
    ),
  );
  const movieRemuxActive = probeFiles.some(
    (p) => activePercentFor(p) !== null,
  );

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
        if (e.target === e.currentTarget && !remux?.running) {
          if (remux) setRemux(null);
          else onClose();
        }
      }}
        >
          <div className="lib-modal">
            <button
              type="button"
              className="lib-modal-close"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>

            <div className="lib-hero" style={hueStyle(name)}>
              {meta?.background && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={meta.background} alt="" className="lib-hero-img" />
              )}
              <div className="lib-hero-fade" />
              <div className="lib-hero-content">
                <span className="lib-hero-poster">
                  {poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
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
                </div>
              </div>
            </div>

            <div className="lib-modal-body">
              {jellyfinConfigured && (
                <>
                  <div className="lib-season-bar">
                    <button
                      type="button"
                      className="btn-secondary lib-en-btn-season"
                      disabled={jfBusy || !probeFiles.length}
                      title="Ask Jellyfin to re-read metadata and images for this item only"
                      onClick={() => void refreshJfMetadata()}
                    >
                      {jfBusy ? "Refreshing…" : "Refresh metadata in Jellyfin"}
                    </button>
                  </div>
                  {(jfStatus || jfError) && (
                    <p
                      className={
                        jfError ? "lib-naming-error" : "lib-en-status"
                      }
                    >
                      {jfError || jfStatus}
                    </p>
                  )}
                </>
              )}

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

              {isShow && activeGroup ? (
                <>
                  <div className="lib-season-bar">
                    {seasonGroups.length > 1 && (
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
                    {seasonRemuxActive ? (
                      <span className="lib-detail-tag is-remuxing">
                        <span className="remux-spin" aria-hidden="true" />
                        Remuxing…
                      </span>
                    ) : (
                      <>
                        {activeGroup.eps.some((ep) =>
                          needsEnglishOnly(langsFor(ep.path)),
                        ) && (
                          <button
                            type="button"
                            className="btn-secondary lib-en-btn-season"
                            disabled={Boolean(enBusy)}
                            onClick={() =>
                              void runRemux(
                                "en-only",
                                activeGroup.eps
                                  .map((ep) => ep.path)
                                  .filter((p): p is string => Boolean(p)),
                              )
                            }
                          >
                            {enBusy ? "Remuxing…" : "English only (season)"}
                          </button>
                        )}
                        {activeGroup.eps.some((ep) =>
                          needsEnglishSubsOnly(langsFor(ep.path)),
                        ) && (
                          <button
                            type="button"
                            className="btn-secondary lib-en-btn-season"
                            disabled={Boolean(enBusy)}
                            onClick={() =>
                              void runRemux(
                                "en-subs",
                                activeGroup.eps
                                  .map((ep) => ep.path)
                                  .filter((p): p is string => Boolean(p)),
                              )
                            }
                          >
                            {enBusy ? "Remuxing…" : "English subs (season)"}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {(enStatus || enError) && (
                    <p className={enError ? "lib-naming-error" : "lib-en-status"}>
                      {enError || enStatus}
                    </p>
                  )}

                  <ul className="lib-detail-list">
                    {activeGroup.eps.map((ep) => {
                      const title = episodeTitles.get(`${ep.season}:${ep.episode}`);
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
                              <span className="lib-detail-file">{ep.fileName}</span>
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
                </>
              ) : null}

              {!isShow && (
                <>
                  {movieRemuxActive ? (
                    <div className="lib-season-bar">
                      <span className="lib-detail-tag is-remuxing">
                        <span className="remux-spin" aria-hidden="true" />
                        Remuxing…
                      </span>
                    </div>
                  ) : (
                    <>
                      {selection.movie.files.some((file) => {
                        const filePath = probeFiles.find(
                          (p) =>
                            p.endsWith(`/${file}`) ||
                            p.endsWith(`\\${file}`) ||
                            p.endsWith(file),
                        );
                        return needsEnglishOnly(langsFor(filePath));
                      }) && (
                        <div className="lib-season-bar">
                          <button
                            type="button"
                            className="btn-secondary lib-en-btn-season"
                            disabled={Boolean(enBusy)}
                            onClick={() => void runRemux("en-only", probeFiles)}
                          >
                            {enBusy ? "Remuxing…" : "English only"}
                          </button>
                        </div>
                      )}
                      {selection.movie.files.some((file) => {
                        const filePath = probeFiles.find(
                          (p) =>
                            p.endsWith(`/${file}`) ||
                            p.endsWith(`\\${file}`) ||
                            p.endsWith(file),
                        );
                        return needsEnglishSubsOnly(langsFor(filePath));
                      }) && (
                        <div className="lib-season-bar">
                          <button
                            type="button"
                            className="btn-secondary lib-en-btn-season"
                            disabled={Boolean(enBusy)}
                            onClick={() =>
                              void runRemux("en-subs", probeFiles)
                            }
                          >
                            {enBusy ? "Remuxing…" : "English subs"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {(enStatus || enError) && (
                    <p className={enError ? "lib-naming-error" : "lib-en-status"}>
                      {enError || enStatus}
                    </p>
                  )}
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
                </>
              )}
            </div>

            <div className="lib-modal-foot">
              <code>{folder}</code>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {remux && (
        <RemuxProgressModal session={remux} onClose={() => setRemux(null)} />
      )}
    </>
  );
}
