"use client";

import { useEffect, useState } from "react";
import { formatBytes, formatSpeed } from "@/lib/comet";
import type { DownloadJob } from "@/lib/types";

export function DownloadsPage() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/downloads");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setJobs(data.jobs || []);
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

  return (
    <div className="page-shell page-enter">
      <div className="page-header">
        <div>
          <p className="page-kicker">Queue</p>
          <h1 className="page-title">Downloads</h1>
          <p className="page-desc">TorBox progress + local save status.</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-[var(--danger)]">{error}</p>
      )}

      {!jobs.length ? (
        <div className="panel flex min-h-[12rem] items-center justify-center p-8">
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
                  <p className="mt-2 text-sm text-[var(--danger)]">{job.error}</p>
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
    </div>
  );
}
