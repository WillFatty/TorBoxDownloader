# Pterodactyl deployment

Run TorBox Downloader on [Pterodactyl Wings](https://pterodactyl.io/) with:

- **CIFS/SMB mount** for your Jellyfin library (e.g. `//192.168.0.234/big_pool` → `/raid2`)
- **GitHub auto-pull** on each start (optional rebuild)

## 1. Build the Docker image (on each Wings node)

From the repo root:

```bash
docker build -f pterodactyl/Dockerfile -t torbox-downloader:latest .
```

Or push to a registry and use that tag in the egg / panel **Docker Images** field.

The image includes `cifs-utils`, `git`, and `gosu`. The entrypoint runs as root to mount SMB, then drops to UID **1000** (matching `uid=1000,gid=1000` on your share).

## 2. SMB / CIFS access

Pterodactyl runs game containers as a **non-root** user, so `mount.cifs` usually cannot run inside the container. Use **one** of these:

### Option A — Host mount + Panel bind (recommended)

Keep your existing host fstab:

```fstab
//192.168.0.234/big_pool  /raid2  cifs  credentials=/root/.smbcredentials2,iocharset=utf8,vers=3.0,_netdev,uid=1000,gid=1000,file_mode=0775,dir_mode=0775  0  0
```

On the Wings node, allow the path in `/etc/pterodactyl/config.yml`:

```yaml
allowed_mounts:
  - /raid2
```

In the Pterodactyl panel: **Server → Mounts** → add:

| Source (host) | Target (container) |
| --- | --- |
| `/raid2` | `/raid2` |

Set egg variable **`SMB_ENABLED=0`**. Set `MOVIES_PATH` / `TV_SHOWS_PATH` under `/raid2/...`.

### Option B — In-container mount (advanced)

Requires the container to start as **root** with **`CAP_SYS_ADMIN`** on Wings. Set egg variables (`SMB_ENABLED=1`, server, share, username, password). The entrypoint writes credentials and mounts with the same options as your fstab (`vers=3.0`, `uid=1000`, etc.).

If mount fails, check Wings logs and `pterodactyl/entrypoint.sh` output.

## 3. Import the egg

1. Admin → **Nests** → choose a nest → **Import Egg**
2. Upload `pterodactyl/egg-torbox-downloader.json`
3. Open the new egg → **Docker Images** → set image to `torbox-downloader:latest` (or your registry URL)
4. Create a **Server** using this egg

Regenerate the egg after editing `install.sh`:

```bash
python3 pterodactyl/build-egg.py
```

## 4. Egg variables (defaults match your setup)

| Variable | Purpose |
| --- | --- |
| `SMB_ENABLED` | `1` to mount on startup |
| `SMB_SERVER` | e.g. `192.168.0.234` |
| `SMB_SHARE` | e.g. `big_pool` |
| `SMB_MOUNT_POINT` | e.g. `/raid2` |
| `SMB_USERNAME` / `SMB_PASSWORD` | CIFS credentials |
| `MOVIES_PATH` | e.g. `/raid2/Jellyfin/Movies` |
| `TV_SHOWS_PATH` | e.g. `/raid2/Jellyfin/TV-Shows` |
| `GITHUB_REPO` | `https://github.com/WillFatty/TorBoxDownloader.git` |
| `GITHUB_BRANCH` | `main` |
| `GITHUB_AUTO_PULL` | `1` to pull on every start |
| `GITHUB_REBUILD_ON_PULL` | `1` to `npm ci && npm run build` after pull |
| `GITHUB_TOKEN` | Optional PAT for private repos |
| `TORBOX_API_KEY`, `COMET_URL`, `SITE_PASSWORD` | App config (same as `.env`) |

Persistent app state (`settings.json`, `jobs.json`) lives in `/home/container/data` via `SETTINGS_PATH` and `JOBS_PATH`.

## 5. Host fstab equivalent

Your host line:

```fstab
//192.168.0.234/big_pool  /raid2  cifs  credentials=/root/.smbcredentials2,iocharset=utf8,vers=3.0,_netdev,uid=1000,gid=1000,file_mode=0775,dir_mode=0775  0  0
```

Egg equivalent (set in panel variables):

- `SMB_SERVER=192.168.0.234`
- `SMB_SHARE=big_pool`
- `SMB_MOUNT_POINT=/raid2`
- `SMB_USERNAME` / `SMB_PASSWORD` from your credentials file

Mount options in `entrypoint.sh`: `iocharset=utf8,vers=3.0,uid=1000,gid=1000,file_mode=0775,dir_mode=0775`.

## 6. Install & startup flow

**Install** (`install.sh`): clone GitHub → `npm ci` → `npm run build` → copy static assets into `.next/standalone/`.

**Startup** (`entrypoint.sh`): optional SMB mount → optional git pull/rebuild → `node .next/standalone/server.js` on `SERVER_PORT`.

## Troubleshooting

- **Mount failed** — Wings missing `SYS_ADMIN`, wrong SMB credentials, or firewall blocking port 445.
- **Build failed on pull** — increase server memory; Next.js build needs ~1–2 GB RAM.
- **Permission denied on library** — share must allow UID 1000 write access (same as your fstab `uid`/`gid`).
