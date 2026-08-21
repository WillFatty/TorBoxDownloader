export type MediaType = "movie" | "series";

export interface SearchResult {
  id: string;
  imdbId: string;
  type: MediaType;
  name: string;
  year: string;
  poster: string | null;
  description?: string;
}

export interface MediaMeta {
  id: string;
  imdbId: string;
  type: MediaType;
  name: string;
  year: string;
  poster: string | null;
  background: string | null;
  description: string;
  genres: string[];
  runtime?: string;
  videos?: EpisodeVideo[];
}

export interface EpisodeVideo {
  id: string;
  season: number;
  episode: number;
  title: string;
  released?: string;
}

export interface StreamResult {
  infoHash: string;
  title: string;
  name: string;
  quality: string;
  size: string | null;
  sizeBytes: number | null;
  seeds: number | null;
  fileIdx: number | null;
  filename: string | null;
  cached: boolean | null;
  url: string | null;
  packHint: string | null;
}

export interface AppSettings {
  torboxApiKey: string;
  cometUrl: string;
  /** Absolute path to Jellyfin Movies library folder */
  moviesPath: string;
  /** Absolute path to Jellyfin TV-Shows library folder */
  tvShowsPath: string;
}

export type DownloadStatus =
  | "queued"
  | "creating"
  | "torbox_downloading"
  | "fetching_link"
  | "saving"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: DownloadStatus;
  progress: number;
  error: string | null;
  mediaName: string;
  mediaType: MediaType;
  imdbId: string | null;
  year: string;
  season: number | null;
  episode: number | null;
  episodeTitle: string | null;
  quality: string;
  infoHash: string;
  fileName: string;
  downloadPath: string;
  torboxTorrentId: number | null;
  torboxFileId: number | null;
  bytesDownloaded: number;
  bytesTotal: number;
  multiEpisode: boolean;
  savedFiles: string[];
  packSummary: string | null;
}

export interface CreateDownloadInput {
  infoHash: string;
  fileIdx: number | null;
  mediaName: string;
  mediaType: MediaType;
  imdbId?: string | null;
  year: string;
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string | null;
  /** Optional preloaded titles from Cinemeta: "1:1" -> "Daybreak" */
  episodeTitles?: Record<string, string> | null;
  quality: string;
  extension?: string;
  customFileName?: string | null;
  useAutoName: boolean;
}
