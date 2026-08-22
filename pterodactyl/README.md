# Pterodactyl deployment

Run TorBox Downloader on [Pterodactyl Wings](https://pterodactyl.io/) with:

- **GitHub clone + auto-pull** on install/startup
- **SMB library access** via a host bind mount (recommended) or optional in-container CIFS

## No custom Docker build required

The egg uses **`ghcr.io/ptero-eggs/yolks:nodejs_22`** by default (community-maintained Pterodactyl yolk with git preinstalled). Official `ghcr.io/pterodactyl/yolks` only publishes up to Node 20 — **`nodejs_22` does not exist there**, which caused the `not found` error.

You do **not** need to run `docker build` unless you want a custom image (see optional section below).

## 1. Import the egg

1. Admin → **Nests** → choose a nest → **Import Egg**
2. Upload `pterodactyl/egg-torbox-downloader.json`
3. Confirm **Docker Images** shows `ghcr.io/ptero-eggs/yolks:nodejs_22` (or pick **Node 22 (Docker Hub)** if GHCR is blocked — set `GITHUB_AUTO_PULL=0` on that image, it has no git)
4. Create a **Server** using this egg and run **Install**

Regenerate the egg after editing `install.sh`:

```bash
python3 pterodactyl/build-egg.py
```

## 2. SMB / library access (recommended: host bind mount)

You already mount the share on the Wings **host**:

```fstab
//192.168.0.234/big_pool  /raid2  cifs  credentials=/root/.smbcredentials2,iocharset=utf8,vers=3.0,_netdev,uid=1000,gid=1000,file_mode=0775,dir_mode=0775  0  0
```

Expose it to the server container:

1. In `/etc/pterodactyl/config.yml` on the Wings node:

```yaml
allowed_mounts:
  - /raid2
```

2. In the panel: **Server → Mounts** → add:

| Source (host) | Target (container) |
| --- | --- |
| `/raid2` | `/raid2` |

3. Set egg variable **`SMB_ENABLED=0`** (default). Set `MOVIES_PATH` / `TV_SHOWS_PATH` under `/raid2/...`.

Pterodactyl containers run as a non-root user, so in-container `mount.cifs` usually does not work on the standard yolk. The host fstab + panel bind mount is the reliable path.

### Optional: in-container SMB (`SMB_ENABLED=1`)

Only if you build the optional custom image (includes `cifs-utils`) and run the container with root + `CAP_SYS_ADMIN`. See **Optional custom Docker image** below.

## 3. Egg variables

| Variable | Purpose |
| --- | --- |
| `SMB_ENABLED` | `0` = use panel bind mount (default). `1` = try in-container mount |
| `SMB_SERVER` | e.g. `192.168.0.234` |
| `SMB_SHARE` | e.g. `big_pool` |
| `SMB_MOUNT_POINT` | e.g. `/raid2` |
| `SMB_USERNAME` / `SMB_PASSWORD` | CIFS credentials (only if `SMB_ENABLED=1`) |
| `MOVIES_PATH` | e.g. `/raid2/Jellyfin/Movies` |
| `TV_SHOWS_PATH` | e.g. `/raid2/Jellyfin/TV-Shows` |
| `GITHUB_REPO` | `https://github.com/WillFatty/TorBoxDownloader.git` |
| `GITHUB_BRANCH` | `main` |
| `GITHUB_AUTO_PULL` | `1` to pull on every start |
| `GITHUB_REBUILD_ON_PULL` | `1` to `npm ci && npm run build` after pull |
| `GITHUB_TOKEN` | Optional PAT for private repos |
| `TORBOX_API_KEY`, `COMET_URL`, `SITE_PASSWORD` | App config (same as `.env`) |

Persistent app state (`settings.json`, `jobs.json`) lives in `/home/container/data` via `SETTINGS_PATH` and `JOBS_PATH`.

## 4. Install & startup flow

**Install** (`install.sh`): clone GitHub → `npm ci` → `npm run build` → copy static assets into `.next/standalone/`.

**Startup** (`pterodactyl/entrypoint.sh`): optional SMB check/mount → optional git pull/rebuild → `node .next/standalone/server.js` on `SERVER_PORT`.

## Optional custom Docker image

Only needed for in-container CIFS mounts. From the repo root:

```bash
docker build -f pterodactyl/Dockerfile -t torbox-downloader:latest .
```

Then change the egg/server **Docker Image** to `torbox-downloader:latest` on that Wings node (or push to a registry and reference that URL).

## Troubleshooting

- **`not found` for `ghcr.io/pterodactyl/yolks:nodejs_22`** — that tag does not exist. Re-import the egg; use `ghcr.io/ptero-eggs/yolks:nodejs_22` or `node:22-bookworm-slim`.
- **`pull access denied for torbox-downloader`** — old egg image name; re-import the updated egg.
- **`server.js not found`** — Run **Reinstall** from the panel (install script builds the app).
- **Build failed on pull** — allocate at least 2 GB RAM; Next.js production builds are memory-heavy.
- **Permission denied on library** — host share `uid`/`gid` must match the user Wings runs the container as (often 988 or 1000).
