# TorBox Downloader — Pterodactyl egg

Runs this repo as a Pterodactyl server on `ghcr.io/ptero-eggs/yolks:nodejs_22`
(Node 22, ffmpeg, ffprobe, git). There is no custom image to build.

Import `pterodactyl/egg.json`. The panel stores the install script from that
file. `install.sh` is the same script, kept here so it can be read. After
editing `install.sh`, regenerate the egg with `node pterodactyl/build-egg.js`.

The installer clones the git repo into the server directory, runs `npm ci` and
`npm run build`, and the server starts with `bash pterodactyl/start.sh`
(`node dist-server/index.js` on the allocated port).

## Library mount (`/raid2`)

`MOVIES_PATH` and `TV_SHOWS_PATH` are paths **inside the container**. The
Jellyfin share lives on the Wings host at `/raid2`. The container only sees it
if that directory is bind-mounted at the same path (`/raid2` → `/raid2`).
Eggs cannot declare mounts; Wings and the panel both have to allow it.

`start.sh` refuses to boot when `/raid2` is missing from `/proc/mounts`, or
when those two paths are not writable directories.

### 1. Share on the Wings host

Same mount as the main README:

```fstab
//192.168.0.234/big_pool  /raid2  cifs  credentials=/root/.smbcredentials2,iocharset=utf8,vers=3.0,_netdev,uid=1000,gid=1000,file_mode=0775,dir_mode=0775  0  0
```

### 2. Let Wings bind-mount it

In the Wings config (`/mnt/pterodactyl/config.yml` or `/etc/pterodactyl/config.yml`):

```yaml
allowed_mounts:
  - /raid2
```

Restart Wings. Without this, Wings logs
`skipping custom server mount, not in list of allowed mount points` and the
container never sees `/raid2`.

### 3. Run the server as the share's owner

The process runs as the node's **User UID / User GID** (Admin → Nodes → the
node). The CIFS mount above is `uid=1000,gid=1000`, so set the node to
**1000 / 1000**. Any other id can read or write neither Movies nor TV-Shows.

### 4. Create the mount in the panel

**Admin → Mounts → New Mount**

| Field          | Value    |
| -------------- | -------- |
| Name           | Library  |
| Source         | `/raid2` |
| Target         | `/raid2` |
| Read Only      | off      |
| User Mountable | on       |

Attach it to the Wings node and to this egg, then enable it on the server
(**Server → Mounts**). The installer does not see `/raid2`; only the running
server container does.

Same path on the host and in the container means the egg variables are host
paths. Defaults:

- `MOVIES_PATH=/raid2/Jellyfin/Movies`
- `TV_SHOWS_PATH=/raid2/Jellyfin/TV-Shows`

## Import and create the server

**Admin → Nests → Import Egg**, and upload `pterodactyl/egg.json` (or, after
this file is on `main`, import from
`https://raw.githubusercontent.com/WillFatty/TorBoxDownloader/main/pterodactyl/egg.json`).

Create a server from the **TorBox Downloader** egg:

- Give it a port allocation. Startup sets `PORT` from Wings' `SERVER_PORT`.
- Set `TORBOX_API_KEY` and `SITE_PASSWORD` at minimum.
- Confirm the `/raid2` mount is enabled on the server.
- Start. The panel marks the server running when the log contains `listening on`.

### Variables

| Variable | Default |
| --- | --- |
| `GIT_ADDRESS` / `GIT_BRANCH` | `https://github.com/WillFatty/TorBoxDownloader` / `main` |
| `TORBOX_API_KEY` (required) | — |
| `SITE_PASSWORD` (required) | — |
| `MOVIES_PATH` | `/raid2/Jellyfin/Movies` |
| `TV_SHOWS_PATH` | `/raid2/Jellyfin/TV-Shows` |
| `COMET_URL` | `https://comet.elfhosted.com` |
| `OMDB_API_KEY` | empty (IMDb score still shows) |
| `JELLYFIN_URL` / `JELLYFIN_API_KEY` | empty |
| `STORAGE_BACKEND` | `redis` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_URL` | `192.168.0.208` / `6379` |
| `AUTH_SECRET` | empty (falls back to `SITE_PASSWORD`) |
| `NODE_ENV` | `production` |

Egg variables are the defaults, same as `.env`. After a value is saved in the
app's Settings page, the saved value wins. Clear the Redis `tbd:settings` key
(or delete `data/settings.json` when `STORAGE_BACKEND=file`) to use the egg
variables again. Settings saved from the old Docker layout (`/raid/Jellyfin/...`)
will not follow this mount until they are updated to `/raid2/Jellyfin/...`.

## State and updates

App state stays under `/home/container/data` (or in Redis). Every start fetches
`GIT_BRANCH` from GitHub and hard-resets the checkout to match it. `data/` is
gitignored, so it is left in place. If the commit changed, startup runs
`npm ci` and `npm run build` before Node starts. An unchanged commit skips the
rebuild.

Re-import this egg and reinstall once so the checkout is writable by the
container user. After that, a normal restart is enough to pick up new commits.

The web UI is password-protected plain HTTP. Put the allocation behind your
reverse proxy. Remux and library probes run ffmpeg; 1 vCPU and about 1 GB is
enough for the UI and downloads. Give the install step a bit more memory if
`npm run build` is killed.
