"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { formatBytes, formatSpeed } from "@/lib/comet";
import type { DownloadJob, DownloadStatus } from "@/lib/types";
import type { RemuxLogEntry, RemuxStatus } from "@/lib/remux-progress";
import { readJson } from "./LibraryShared";

type Tone = "neutral" | "info" | "accent" | "danger" | "warn";
type Filter = "all" | "active" | "done" | "issues";

const ACTIVE_JOB_STATUSES: ReadonlySet<DownloadStatus> = new Set([
  "queued",
  "creating",
  "torbox_downloading",
  "fetching_link",
  "saving",
]);

const JOB_TONE: Record<DownloadStatus, Tone> = {
  queued: "neutral",
  creating: "neutral",
  torbox_downloading: "info",
  fetching_link: "info",
  saving: "info",
  completed: "accent",
  failed: "danger",
  cancelled: "warn",
};

const REMUX_TONE: Record<RemuxStatus, Tone> = {
  queued: "neutral",
  working: "info",
  done: "accent",
  skipped: "warn",
  failed: "danger",
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: "",
  info: "is-info",
  accent: "is-accent",
  danger: "is-danger",
  warn: "is-warn",
};

const FILL_CLASS: Partial<Record<Tone, string>> = {
  info: "is-info",
  danger: "is-danger",
  warn: "is-warn",
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function episodeCode(job: DownloadJob): string | null {
  if (job.season == null || job.episode == null) return null;
  return `S${String(job.season).padStart(2, "0")}E${String(job.episode).padStart(2, "0")}`;
}

function StatusBadge({
  tone,
  live,
  children,
}: {
  tone: Tone;
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`status-badge ${TONE_CLASS[tone]}`.trim()}>
      <span
        className={`status-dot${live ? " is-pulsing" : ""}`}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}

function MetaTag({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`meta-tag ${tone ? TONE_CLASS[tone] : ""}`.trim()}>
      {children}
    </span>
  );
}

function SectionHead({
  title,
  shown,
  total,
}: {
  title: string;
  shown: number;
  total: number;
}) {
  return (
    <div className="log-section-head">
      <h2 className="log-section-title">{title}</h2>
      <span className="log-section-count">
        {total === shown ? total : `${shown} of ${total}`}
      </span>
    </div>
  );
}

function EmptyPanel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="log-empty">
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

function ProgressRow({
  percent,
  fillClass,
  active,
}: {
  percent: number;
  fillClass?: string;
  active: boolean;
}) {
  return (
    <div className="log-progress">
      <div className="progress-track">
        <div
          className={`progress-fill ${fillClass ?? ""}`.trim()}
          style={{
            width: `${Math.max(percent, 2)}%`,
            animationPlayState: active ? "running" : "paused",
          }}
        />
      </div>
      <span className="progress-num">{Math.round(percent)}%</span>
    </div>
  );
}

function DownloadCard({
  job,
  busy,
  onCancel,
  onRetry,
  onDelete,
}: {
  job: DownloadJob;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const tone = JOB_TONE[job.status];
  const active = ACTIVE_JOB_STATUSES.has(job.status);
  const retryable = job.status === "failed" || job.status === "cancelled";
  const speed = active ? formatSpeed(job.speedBytesPerSec) : null;
  const transferred =
    job.bytesDownloaded > 0
      ? [
          formatBytes(job.bytesDownloaded),
          job.bytesTotal > 0 ? formatBytes(job.bytesTotal) : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : null;
  const code = episodeCode(job);

  return (
    <li className={`log-card${active ? " is-live" : ""}`}>
      <div className="log-card-top">
        <div className="log-card-copy">
          <div className="log-card-title">{job.fileName}</div>
          {job.episodeTitle && (
            <div className="log-card-sub">{job.episodeTitle}</div>
          )}
          <div className="log-card-path">{job.downloadPath}</div>
        </div>
        <StatusBadge tone={tone} live={active}>
          {job.status.replace(/_/g, " ")}
        </StatusBadge>
      </div>

      <ProgressRow
        percent={job.status === "completed" ? 100 : job.progress}
        fillClass={FILL_CLASS[tone]}
        active={active}
      />

      <div className="meta-tags">
        {transferred && <MetaTag>{transferred}</MetaTag>}
        {speed && <MetaTag tone="accent">{speed}</MetaTag>}
        <MetaTag>
          {job.mediaName}
          {code ? ` · ${code}` : ""}
        </MetaTag>
        <MetaTag>{job.quality}</MetaTag>
        {job.torboxTorrentId != null && (
          <MetaTag>torrent #{job.torboxTorrentId}</MetaTag>
        )}
        <MetaTag>{timeAgo(job.updatedAt)}</MetaTag>
      </div>

      {job.error && <p className="log-error">{job.error}</p>}
      {job.packSummary && (
        <p className="log-pack">{job.packSummary}</p>
      )}

      {job.savedFiles?.length > 1 && (
        <details className="log-files">
          <summary>{job.savedFiles.length} saved files</summary>
          <ul>
            {job.savedFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="log-actions">
        {active && (
          <button
            type="button"
            className="btn-secondary btn-small"
            disabled={busy}
            onClick={onCancel}
          >
            {busy ? "…" : "Cancel"}
          </button>
        )}
        {retryable && (
          <button
            type="button"
            className="btn-secondary btn-small"
            disabled={busy}
            onClick={onRetry}
          >
            {busy ? "…" : "Retry"}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost-danger"
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function RemuxCard({ entry }: { entry: RemuxLogEntry }) {
  const tone = REMUX_TONE[entry.status];
  const active = entry.status === "queued" || entry.status === "working";

  return (
    <li className={`log-card${active ? " is-live" : ""}`}>
      <div className="log-card-top">
        <div className="log-card-copy">
          <div className="log-card-title">{entry.fileName}</div>
          <div className="log-card-path">{entry.file}</div>
        </div>
        <StatusBadge tone={tone} live={active}>
          {entry.status}
        </StatusBadge>
      </div>

      <ProgressRow
        percent={
          entry.status === "done" || entry.status === "skipped"
            ? 100
            : entry.percent
        }
        fillClass={FILL_CLASS[tone]}
        active={active}
      />

      <div className="meta-tags">
        <MetaTag>ffmpeg remux</MetaTag>
        <MetaTag>{timeAgo(entry.updatedAt)}</MetaTag>
      </div>

      {entry.error && <p className="log-error">{entry.error}</p>}
    </li>
  );
}

export function LogsPage() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [remuxEntries, setRemuxEntries] = useState<RemuxLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [live, setLive] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    try {
      const [downloadsRes, remuxRes] = await Promise.all([
        fetch("/api/downloads"),
        fetch("/api/remux"),
      ]);
      const downloadsData = await readJson<{
        jobs?: DownloadJob[];
        error?: string;
      }>(downloadsRes);
      if (!downloadsRes.ok)
        throw new Error(downloadsData.error || "Failed to load downloads");
      setJobs(downloadsData.jobs || []);

      if (remuxRes.ok) {
        const remuxData = await readJson<{ entries?: RemuxLogEntry[] }>(
          remuxRes,
        );
        setRemuxEntries(remuxData.entries || []);
      } else {
        setRemuxEntries([]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  useEffect(() => {
    void refresh();
    if (!live) return;
    const id = setInterval(() => void refresh(), 1500);
    return () => clearInterval(id);
  }, [live]);

  async function jobAction(id: string, kind: "cancel" | "retry" | "delete") {
    setBusyId(id);
    try {
      const res =
        kind === "delete"
          ? await fetch(`/api/downloads/${id}`, { method: "DELETE" })
          : await fetch(`/api/downloads/${id}/${kind}`, { method: "POST" });
      if (!res.ok) {
        const data = await readJson<{ error?: string }>(res);
        throw new Error(data.error || "Action failed");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  const activeJobs = jobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status));
  const doneJobs = jobs.filter((job) => job.status === "completed");
  const issueJobs = jobs.filter(
    (job) => job.status === "failed" || job.status === "cancelled",
  );
  const activeRemux = remuxEntries.filter(
    (entry) => entry.status === "queued" || entry.status === "working",
  ).length;
  const totalSpeed = activeJobs.reduce(
    (sum, job) => sum + job.speedBytesPerSec,
    0,
  );

  const filteredJobs =
    filter === "active"
      ? activeJobs
      : filter === "done"
        ? doneJobs
        : filter === "issues"
          ? issueJobs
          : jobs;
  const shownJobs = [...filteredJobs].sort((a, b) => {
    const rank =
      (ACTIVE_JOB_STATUSES.has(a.status) ? 0 : 1) -
      (ACTIVE_JOB_STATUSES.has(b.status) ? 0 : 1);
    return rank || b.updatedAt.localeCompare(a.updatedAt);
  });

  const FILTER_COUNTS: Record<Filter, number> = {
    all: jobs.length,
    active: activeJobs.length,
    done: doneJobs.length,
    issues: issueJobs.length,
  };
  const FILTER_LABELS: Record<Filter, string> = {
    all: "All",
    active: "Active",
    done: "Done",
    issues: "Issues",
  };

  return (
    <div className="logs-page page-enter">
      <header className="logs-hero">
        <div className="logs-hero-copy">
          <p className="page-kicker">Activity</p>
          <h1 className="page-title">Logs</h1>
          <p className="page-desc">
            Live download queue and remux progress.
          </p>
        </div>
        <div className="logs-hero-actions">
          <button
            type="button"
            className={`chip${live ? " chip-active" : ""}`}
            onClick={() => setLive((value) => !value)}
            title={live ? "Pause auto-refresh" : "Resume auto-refresh"}
          >
            <span
              className={`status-dot${live ? " is-pulsing" : ""}`}
              aria-hidden="true"
            />
            {live ? "Live" : "Paused"}
          </button>
          <button
            type="button"
            className="btn-secondary btn-small"
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="logs-pulse">
        <div className="logs-pulse-item">
          <span className="logs-pulse-value">{activeJobs.length}</span>
          <span className="logs-pulse-label">Downloading</span>
        </div>
        <div className="logs-pulse-item">
          <span className="logs-pulse-value logs-pulse-speed">
            {formatSpeed(totalSpeed) ?? "—"}
          </span>
          <span className="logs-pulse-label">Total speed</span>
        </div>
        <div className="logs-pulse-item">
          <span className="logs-pulse-value">{activeRemux}</span>
          <span className="logs-pulse-label">Remuxing</span>
        </div>
        <div className="logs-pulse-item">
          <span className="logs-pulse-value">{doneJobs.length}</span>
          <span className="logs-pulse-label">Completed</span>
        </div>
        <div
          className={`logs-pulse-item${issueJobs.length ? " is-warn" : ""}`}
        >
          <span className="logs-pulse-value">{issueJobs.length}</span>
          <span className="logs-pulse-label">Failed</span>
        </div>
      </div>

      <div className="log-toolbar">
        <div className="segmented">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
            <button
              key={key}
              type="button"
              className={filter === key ? "is-active" : ""}
              onClick={() => setFilter(key)}
            >
              {FILTER_LABELS[key]}
              <span className="segmented-count">{FILTER_COUNTS[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="log-alert">{error}</p>}

      <div className="logs-body">
        <section className="log-pane">
          <SectionHead
            title="Downloads"
            shown={shownJobs.length}
            total={jobs.length}
          />
          <div className="log-pane-scroll">
            {!shownJobs.length ? (
              <EmptyPanel
                title={
                  jobs.length
                    ? "Nothing matches this filter"
                    : "No downloads yet"
                }
                hint={
                  jobs.length
                    ? undefined
                    : "Start something from search and it will show up here."
                }
              />
            ) : (
              <ul className="log-list">
                {shownJobs.map((job) => (
                  <DownloadCard
                    key={job.id}
                    job={job}
                    busy={busyId === job.id}
                    onCancel={() => void jobAction(job.id, "cancel")}
                    onRetry={() => void jobAction(job.id, "retry")}
                    onDelete={() => void jobAction(job.id, "delete")}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="log-pane">
          <SectionHead
            title="Remuxing"
            shown={remuxEntries.length}
            total={remuxEntries.length}
          />
          <div className="log-pane-scroll">
            {!remuxEntries.length ? (
              <EmptyPanel
                title="No remux activity yet"
                hint="Finished downloads are converted to MP4 here."
              />
            ) : (
              <ul className="log-list">
                {remuxEntries.map((entry) => (
                  <RemuxCard key={entry.file} entry={entry} />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
