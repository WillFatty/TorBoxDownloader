# TorBox Downloader

Next.js app: search movies/TV (Cinemeta) → streams via [Comet](https://github.com/g0ldyy/comet) → download with [TorBox](https://torbox.app) → save to a folder with auto or custom names.

Example auto name: `Ant Man (2015) - 1080p.mkv`  
TV: `Breaking Bad - S01E01 - 1080p.mkv`

## Setup

1. Copy env:

```bash
cp .env.example .env
```

2. Fill:

- `TORBOX_API_KEY` — from TorBox settings
- `COMET_URL` — public `https://comet.elfhosted.com` or your self-hosted Comet
- `MOVIES_PATH` — e.g. `/raid/Jellyfin/Movies`
- `TV_SHOWS_PATH` — e.g. `/raid/Jellyfin/TV-Shows`
- `SITE_PASSWORD` — password gate for the website

3. Install & run:

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

## Pterodactyl

Deploy on Pterodactyl with GitHub auto-pull and SMB library access:

1. Import `pterodactyl/egg-torbox-downloader.json` in the panel (default image: `ghcr.io/ptero-eggs/yolks:nodejs_22`)
2. Bind-mount your host `/raid2` share in **Server → Mounts**
3. Configure variables (see [pterodactyl/README.md](pterodactyl/README.md))
