
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DownloadJob } from "@/lib/types";

interface RemuxEntry {
  file: string;
  fileName: string;
  status: "queued" | "working" | "done" | "failed" | "skipped";
  percent: number;
  error?: string;
}

const ACTIVE_JOBS = new Set([
  "queued",
  "creating",
  "torbox_downloading",
  "fetching_link",
  "saving",
]);

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  creating: "Creating torrent",
  torbox_downloading: "TorBox downloading",
  fetching_link: "Fetching link",
  saving: "Saving to disk",
};

function fmtBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function jobName(job: DownloadJob): string {
  return job.multiEpisode
    ? `${job.mediaName} · episode pack`
    : job.fileName || job.mediaName;
}

export function ActivityNotifier() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [remuxes, setRemuxes] = useState<RemuxEntry[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      Promise.all([fetch("/api/downloads"), fetch("/api/remux")])
        .then(async ([downloadsRes, remuxRes]) => {
          if (cancelled) return;
          if (downloadsRes.status === 401 || remuxRes.status === 401) {
            const next = `${window.location.pathname}${window.location.search}`;
            window.location.assign(`/login?next=${encodeURIComponent(next)}`);
            return;
          }
          const d = (await downloadsRes.json()) as { jobs?: DownloadJob[] };
          const r = (await remuxRes.json()) as { entries?: RemuxEntry[] };
          if (cancelled) return;
          setJobs(Array.isArray(d?.jobs) ? d.jobs : []);
          setRemuxes(Array.isArray(r?.entries) ? r.entries : []);
        })
        .catch(() => {});
    };
    pull();
    const id = setInterval(pull, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const activeJobs = jobs.filter((j) => ACTIVE_JOBS.has(j.status));
  const activeRemuxes = remuxes.filter(
    (r) => r.status === "working" || r.status === "queued",
  );
  const count = activeJobs.length + activeRemuxes.length;

  if (typeof document === "undefined") return null;

  return createPortal(
    count > 0 ? (
      <section className="activity-dock" aria-label="Active downloads">
        <button
          type="button"
          className="activity-head"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="activity-dot" aria-hidden="true" />
          <span className="activity-title">
            {count} active
          </span>
          <span className="activity-chevron" aria-hidden="true">
            {open ? "▾" : "▴"}
          </span>
        </button>

        {open && (
          <ul className="activity-list">
            {activeJobs.map((job) => (
              <li key={job.id} className="activity-item">
                <div className="activity-line">
                  <span className="activity-name" title={job.fileName}>
                    {jobName(job)}
                  </span>
                  <span className="activity-pct">
                    {Math.round(job.progress)}%
                  </span>
                </div>
                <div className="activity-bar">
                  <span style={{ width: `${job.progress}%` }} />
                </div>
                <div className="activity-sub">
                  <span>{JOB_STATUS_LABEL[job.status] ?? job.status}</span>
                  <span>
                    {job.bytesTotal > 0 &&
                      `${fmtBytes(job.bytesDownloaded)} / ${fmtBytes(job.bytesTotal)}`}
                    {job.bytesTotal > 0 &&
                      job.speedBytesPerSec > 0 &&
                      " · "}
                    {job.speedBytesPerSec > 0 &&
                      `${fmtBytes(job.speedBytesPerSec)}/s`}
                  </span>
                </div>
              </li>
            ))}

            {activeRemuxes.map((entry) => (
              <li key={entry.file} className="activity-item">
                <div className="activity-line">
                  <span className="activity-name" title={entry.fileName}>
                    {entry.fileName}
                  </span>
                  <span className="activity-pct">
                    {entry.status === "queued"
                      ? "…"
                      : `${Math.round(entry.percent)}%`}
                  </span>
                </div>
                {entry.status === "working" && (
                  <div className="activity-bar">
                    <span style={{ width: `${entry.percent}%` }} />
                  </div>
                )}
                <div className="activity-sub">
                  <span>Remux</span>
                  <span>
                    {entry.status === "queued" ? "queued" : "in progress"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    ) : null,
    document.body,
  );
}
