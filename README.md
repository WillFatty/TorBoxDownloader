# TorBox Downloader

Next.js app: search movies/TV (Cinemeta) → streams via [Comet](https://github.com/g0ldyy/comet) → download with [TorBox](https://torbox.app) → save to a folder with auto or custom names.

Example auto name: `Ant Man (2015) - 1080p.mkv`  
TV: `Breaking Bad - S01E01 - 1080p.mkv`

## Docker (recommended)

1. Mount your library share on the host (example fstab entry):

```fstab
//192.168.0.234/big_pool  /raid2  cifs  credentials=/root/.smbcredentials2,iocharset=utf8,vers=3.0,_netdev,uid=1000,gid=1000,file_mode=0775,dir_mode=0775  0  0
```

If the host path is `/raid2` but the app uses `/raid/Jellyfin/...` inside the container, set `LIBRARY_ROOT=/raid2` in `.env`. Compose bind-mounts **host** `LIBRARY_ROOT` → **container** `/raid`.

2. Copy and edit env:

```bash
cp .env.example .env
```

Set `TORBOX_API_KEY`, `SITE_PASSWORD`, and library paths. Defaults:

- `MOVIES_PATH=/raid/Jellyfin/Movies` (inside the container)
- `LIBRARY_ROOT=/raid` on the host, or `/raid2` if that is where your SMB share is mounted

3. Build and run:

```bash
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000).

The image includes **ffmpeg** so the library detail modal can show audio / subtitle languages and remux files to **English-only** tracks.

`docker-compose.yml` bind-mounts:
- `./data` → app state (`settings.json`, `jobs.json`, artwork cache)
- `${LIBRARY_ROOT}` on the host → `/raid` in the container (must match `MOVIES_PATH` / `TV_SHOWS_PATH`)

The container runs as UID **1000** to match typical CIFS `uid=1000,gid=1000` mounts.

### Useful commands

```bash
docker compose logs -f
docker compose down
docker compose up -d --build   # rebuild after code changes
```

## Local development

1. Copy env:

```bash
cp .env.example .env
```

2. Fill in `TORBOX_API_KEY`, `COMET_URL`, `MOVIES_PATH`, `TV_SHOWS_PATH`, `SITE_PASSWORD`.

3. Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Settings page can override env values (stored in `data/settings.json`).

## Jellyfin layout

Separate folders for each library:

```
{MOVIES_PATH}/{Title} ({Year})/{Title} ({Year}) - {Quality}.mkv
{TV_SHOWS_PATH}/{Show}/Season {N}/{Show} - SxxExx - {Episode Title}.mkv
```

## Flow

1. Search title
2. Pick movie / pick TV season+episode → Load streams
3. Choose Comet result (TorBox cache badge when API key set)
4. Auto name or custom filename
5. Download — creates TorBox torrent, waits until ready, pulls file into Movies or TV-Shows path

## Notes

- Download path must be writable by the Node process (local machine / server, not the browser).
- Public Comet instances rate-limit; self-host for heavy use.
- Jobs tracked in `data/jobs.json`. Active jobs fail on server restart.

## TODO
- Make jellyfin plugin