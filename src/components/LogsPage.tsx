"use client";

import { useEffect, useState } from "react";
import { formatBytes, formatSpeed } from "@/lib/comet";
import type { DownloadJob } from "@/lib/types";
import type { RemuxLogEntry } from "@/lib/remux-progress";
import { readJson } from "./LibraryShared";

const REMUX_BADGE: Record<string, string> = {
  queued: "bg-[var(--line)] text-[var(--muted)]",
  working: "bg-[var(--info)]/15 text-[var(--info)]",
  done: "bg-[var(--accent-soft)] text-[var(--accent)]",
  skipped: "bg-[var(--warn)]/15 text-[var(--warn)]",
  failed: "bg-[var(--danger)]/15 text-[var(--danger)]",
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function RemuxSection({ entries }: { entries: RemuxLogEntry[] }) {
  if (!entries.length) {
    return (
      <div className="panel flex min-h-[8rem] items-center justify-center p-8">
        <p className="text-[var(--muted)]">No remux activity yet.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {entries.map((entry) => {
        const active = entry.status === "queued" || entry.status === "working";
        return (
          <li key={entry.file} className="panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-[var(--ink)]">
                  {entry.fileName}
                </div>
                <div className="mt-1 truncate font-mono text-xs text-[var(--muted)]">
                  {entry.file}
                </div>
              </div>
              <span
                className={`badge uppercase tracking-wide ${REMUX_BADGE[entry.status] ?? REMUX_BADGE.queued}`}
              >
                {entry.status}
              </span>
            </div>
            <div className="progress-track mt-4">
              <div
                className="progress-fill"
                style={{
                  width: `${Math.max(entry.percent, entry.status === "done" || entry.status === "skipped" ? 100 : 2)}%`,
                  animationPlayState: active ? "running" : "paused",
                }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
              {active && <span>{entry.percent}%</span>}
              <span>{timeAgo(entry.updatedAt)}</span>
            </div>
            {entry.error && (
              <p className="mt-2 text-sm text-[var(--danger)]">{entry.error}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function LogsPage() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [remuxEntries, setRemuxEntries] = useState<RemuxLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        const remuxData = await readJson<{ entries?: RemuxLogEntry[] }>(remuxRes);
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
    const id = setInterval(() => void refresh(), 1500);
    return () => clearInterval(id);
  }, []);

  const activeRemux = remuxEntries.filter(
    (e) => e.status === "queued" || e.status === "working",
  ).length;
  const activeDownloads = jobs.filter(
    (job) =>
      job.status !== "completed" &&
      job.status !== "failed" &&
      job.status !== "cancelled",
  ).length;

  return (
    <div className="page-shell page-enter">
      <div className="page-header">
        <div>
          <p className="page-kicker">Activity</p>
          <h1 className="page-title">Logs</h1>
          <p className="page-desc">
            Download queue + remuxing progress.
            {(activeDownloads > 0 || activeRemux > 0) && (
              <span className="ml-2 text-[var(--accent)]">
                {activeDownloads} downloading · {activeRemux} remuxing
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-[var(--danger)]">{error}</p>}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-[var(--muted)]">
          Downloads
        </h2>
        {!jobs.length ? (
          <div className="panel flex min-h-[8rem] items-center justify-center p-8">
            <p className="text-[var(--muted)]">No downloads yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => {
              const speed = formatSpeed(job.speedBytesPerSec);
              const transferred =
                job.bytesDownloaded > 0
                  ? [
                      formatBytes(job.bytesDownloaded),
                      job.bytesTotal > 0 ? formatBytes(job.bytesTotal) : null,
                    ]
                      .filter(Boolean)
                      .join(" / ")
                  : null;
              const active =
                job.status !== "completed" &&
                job.status !== "failed" &&
                job.status !== "cancelled";
              return (
                <li key={job.id} className="panel p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--ink)]">
                        {job.fileName}
                      </div>
                      <div className="mt-1.5 truncate font-mono text-xs text-[var(--muted)]">
                        {job.downloadPath}
                      </div>
                    </div>
                    <span
                      className={`badge uppercase tracking-wide ${
                        job.status === "completed"
                          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                          : job.status === "failed"
                            ? "bg-[var(--danger)]/15 text-[var(--danger)]"
                            : "bg-[var(--line)] text-[var(--muted)]"
                      }`}
                    >
                      {job.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="progress-track mt-4">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${job.progress}%`,
                        animationPlayState: active ? "running" : "paused",
                      }}
                    />
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                    <span>{job.progress}%</span>
                    {transferred && <span>{transferred}</span>}
                    {speed && <span>{speed}</span>}
                    <span>
                      {job.mediaName}
                      {job.season != null && job.episode != null
                        ? ` S${String(job.season).padStart(2, "0")}E${String(job.episode).padStart(2, "0")}`
                        : ""}
                    </span>
                    <span>{job.quality}</span>
                    {job.torboxTorrentId != null && (
                      <span>torrent #{job.torboxTorrentId}</span>
                    )}
                  </div>
                  {job.error && (
                    <p className="mt-2 text-sm text-[var(--danger)]">
                      {job.error}
                    </p>
                  )}
                  {job.packSummary && (
                    <p className="mt-2 text-sm text-[var(--violet)]">
                      {job.packSummary}
                    </p>
                  )}
                  {job.savedFiles?.length > 1 && (
                    <details className="mt-2 text-xs text-[var(--muted)]">
                      <summary className="cursor-pointer hover:text-[var(--ink-soft)]">
                        {job.savedFiles.length} saved files
                      </summary>
                      <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto font-mono">
                        {job.savedFiles.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-[var(--muted)]">
          Remuxing
        </h2>
        <RemuxSection entries={remuxEntries} />
      </section>
    </div>
  );
}
