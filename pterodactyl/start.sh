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

export PORT="${SERVER_PORT:-3000}"
exec node dist-server/index.js
