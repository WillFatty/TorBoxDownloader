#!/bin/bash
# Runtime entry. The egg startup command is: bash pterodactyl/start.sh
# Wings' entrypoint evals that as a single simple command.
set -euo pipefail

cd /home/container

if ! grep -q ' /raid2 ' /proc/mounts; then
  echo "ERROR: host /raid2 is not mounted at /raid2 in this container."
  echo "MOVIES_PATH and TV_SHOWS_PATH are paths inside the container, so they only work when that mount exists."
  echo "1. On the Wings host, add /raid2 to allowed_mounts in /mnt/pterodactyl/config.yml (or /etc/pterodactyl/config.yml) and restart wings."
  echo "2. In the panel: Admin -> Mounts -> Source /raid2, Target /raid2, Read Only off."
  echo "3. Attach the mount to this node and this egg, then enable it on the server (Server -> Mounts)."
  echo "MOVIES_PATH=${MOVIES_PATH:-unset}"
  echo "TV_SHOWS_PATH=${TV_SHOWS_PATH:-unset}"
  exit 1
fi

for dir in "${MOVIES_PATH:-}" "${TV_SHOWS_PATH:-}"; do
  if [ -z "${dir}" ]; then
    echo "ERROR: MOVIES_PATH and TV_SHOWS_PATH must both be set."
    exit 1
  fi
  if [ ! -d "${dir}" ]; then
    echo "ERROR: ${dir} is not a directory inside the container."
    echo "With /raid2 mounted at /raid2, use the same path you would use on the Wings host (for example /raid2/Jellyfin/Movies)."
    exit 1
  fi
  if [ ! -w "${dir}" ]; then
    echo "ERROR: ${dir} is not writable by uid $(id -u) gid $(id -g)."
    echo "The CIFS share is mounted on the host as uid=1000,gid=1000. Set this node's User UID and User GID to 1000 and 1000, then restart wings."
    exit 1
  fi
done

# Match GitHub on every start. data/ is gitignored and is left in place.
# Rebuild only when the commit changed so an unchanged restart stays fast.
if [ -d .git ]; then
  GIT_ADDRESS="${GIT_ADDRESS:-https://github.com/WillFatty/TorBoxDownloader.git}"
  GIT_BRANCH="${GIT_BRANCH:-main}"
  if [[ "${GIT_ADDRESS}" != *.git ]]; then
    GIT_ADDRESS="${GIT_ADDRESS}.git"
  fi

  echo "Updating ${GIT_ADDRESS} (${GIT_BRANCH})..."
  git -c safe.directory=/home/container remote set-url origin "${GIT_ADDRESS}"
  before="$(git -c safe.directory=/home/container rev-parse HEAD)"

  if git -c safe.directory=/home/container fetch --depth 1 origin "+refs/heads/${GIT_BRANCH}:refs/remotes/origin/${GIT_BRANCH}"; then
    git -c safe.directory=/home/container reset --hard "origin/${GIT_BRANCH}"
  else
    git -c safe.directory=/home/container fetch --depth 1 origin "refs/tags/${GIT_BRANCH}"
    git -c safe.directory=/home/container reset --hard FETCH_HEAD
  fi

  after="$(git -c safe.directory=/home/container rev-parse HEAD)"
  if [ "${before}" = "${after}" ]; then
    echo "Already at ${after}."
  else
    echo "Updated ${before} -> ${after}. Rebuilding..."
    rm -rf node_modules dist dist-server
    npm ci --include=dev --no-audit --no-fund
    npm run build
  fi
else
  echo "No git checkout; starting the installed build. Reinstall to enable GitHub updates."
fi

export PORT="${SERVER_PORT:-3000}"
exec node dist-server/index.js
