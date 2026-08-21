"use client";

import { useEffect, useState } from "react";
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
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            Downloads
          </h1>
          <p className="mt-2 text-[var(--muted)]">
            TorBox progress + local save status.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!jobs.length ? (
        <p className="text-[var(--muted)]">No downloads yet.</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-[var(--ink)]">{job.fileName}</div>
                  <div className="mt-1 font-mono text-xs text-[var(--muted)]">
                    {job.downloadPath}
                  </div>
                </div>
                <span className="rounded bg-[var(--line)] px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--muted)]">
                  {job.status.replace(/_/g, " ")}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded bg-[var(--line)]">
                <div
                  className="h-full bg-[var(--accent)] transition-all"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                <span>{job.progress}%</span>
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
                <p className="mt-2 text-sm text-red-400">{job.error}</p>
              )}
              {job.packSummary && (
                <p className="mt-2 text-sm text-violet-300">{job.packSummary}</p>
              )}
              {job.savedFiles?.length > 1 && (
                <details className="mt-2 text-xs text-[var(--muted)]">
                  <summary>{job.savedFiles.length} saved files</summary>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto font-mono">
                    {job.savedFiles.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
