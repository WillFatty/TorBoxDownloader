"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { MediaMeta } from "@/lib/types";
import {
  hueStyle,
  tileInitials,
  type ArtworkEntry,
  type LibSelection,
  type LibShow,
} from "./LibraryShared";

const RESOLUTION = /\b(2160p|1080p|720p|480p|4k)\b/i;

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
}: {
  selection: LibSelection;
  art: ArtworkEntry | undefined;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  const isShow = selection.kind === "show";
  const name = isShow ? selection.show.name : selection.movie.name;
  const folder = isShow ? selection.show.folder : selection.movie.folder;
  const imdbId = art?.imdbId ?? null;
  const poster = art?.poster ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
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
        const data = (await res.json()) as { meta?: MediaMeta };
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
  return createPortal(
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

          {isShow && activeGroup ? (
            <>
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
                      {res && <span className="lib-detail-tag">{res}</span>}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {!isShow && (
            <ul className="lib-detail-list">
              {selection.movie.files.map((file) => {
                const res = resolutionOf(file);
                return (
                  <li key={file} className="lib-detail-row">
                    <span className="lib-detail-text">
                      <span className="lib-detail-title">{file}</span>
                    </span>
                    {res && <span className="lib-detail-tag">{res}</span>}
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
  );
}
