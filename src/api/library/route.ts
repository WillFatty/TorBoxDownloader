
import {
  libraryHasEpisode,
  libraryHasMovie,
  libraryHasShow,
  scanLibrary,
} from "@/lib/library";
import { getSettings } from "@/lib/settings";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const check = searchParams.get("check");
    const type = searchParams.get("type");
    const name = searchParams.get("name");
    const year = searchParams.get("year") || undefined;
    const season = searchParams.get("season");
    const episode = searchParams.get("episode");
    const force = searchParams.get("force") === "1";

    const [library, settings] = await Promise.all([
      scanLibrary({ force }),
      getSettings(),
    ]);

    if (check === "1" && name && type) {
      if (type === "movie") {
        const hit = libraryHasMovie(library, name, year);
        return Response.json({
          inLibrary: Boolean(hit),
          movie: hit,
        });
      }
      if (type === "series") {
        const show = libraryHasShow(library, name);
        const hasEpisode =
          show && season && episode
            ? libraryHasEpisode(show, Number(season), Number(episode))
            : false;
        return Response.json({
          inLibrary: Boolean(show),
          hasEpisode,
          show: show
            ? {
                name: show.name,
                seasons: show.seasons,
                episodeCount: show.episodeCount,
              }
            : null,
        });
      }
    }

    return Response.json({
      library: {
        root: library.root,
        moviesPath: settings.moviesPath,
        tvShowsPath: settings.tvShowsPath,
        jellyfinConfigured: Boolean(
          settings.jellyfinUrl.trim() && settings.jellyfinApiKey.trim(),
        ),
        scannedAt: library.scannedAt,
        movies: library.movies.map((m) => ({
          name: m.name,
          year: m.year,
          fileCount: m.files.length,
          files: m.files,
          folder: m.folder,
        })),
        shows: library.shows.map((s) => ({
          name: s.name,
          seasons: s.seasons,
          episodeCount: s.episodeCount,
          folder: s.folder,
          episodes: s.episodes.map((e) => ({
            season: e.season,
            episode: e.episode,
            fileName: e.fileName,
            path: e.path,
          })),
        })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Library scan failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
