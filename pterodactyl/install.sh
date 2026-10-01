#!/bin/bash
#
# TorBox Downloader installation script.
#
# This file is the source of truth. pterodactyl/egg.json embeds the same
# script under scripts.installation.script (the panel stores it inline).
#
# Wings runs this as root in the installer container. Server files are
# bind-mounted at /mnt/server, which becomes /home/container at runtime.
# Custom mounts such as /raid2 are not available here, so this script never
# touches MOVIES_PATH or TV_SHOWS_PATH.
#
set -euo pipefail

cd /mnt/server

git config --global --add safe.directory /mnt/server

GIT_ADDRESS="${GIT_ADDRESS:-https://github.com/WillFatty/TorBoxDownloader.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
if [[ "${GIT_ADDRESS}" != *.git ]]; then
  GIT_ADDRESS="${GIT_ADDRESS}.git"
fi

echo "Node $(node -v) | npm $(npm -v)"
echo "ffmpeg: $(command -v ffmpeg || echo MISSING) | ffprobe: $(command -v ffprobe || echo MISSING)"

if [ -d .git ]; then
  echo "Updating ${GIT_ADDRESS} (${GIT_BRANCH})..."
  if git fetch --depth 1 origin "+refs/heads/${GIT_BRANCH}:refs/remotes/origin/${GIT_BRANCH}"; then
    git reset --hard "origin/${GIT_BRANCH}"
  else
    git fetch --depth 1 origin "refs/tags/${GIT_BRANCH}"
    git reset --hard FETCH_HEAD
  fi
else
  shopt -s nullglob dotglob
  existing=(*)
  shopt -u nullglob dotglob
  if [ "${#existing[@]}" -gt 0 ]; then
    echo "ERROR: /mnt/server is not empty and has no .git directory."
    echo "Reinstall only works on a fresh server or an existing checkout of this repo."
    exit 1
  fi
  echo "Cloning ${GIT_ADDRESS} (${GIT_BRANCH})..."
  git clone --depth 1 --branch "${GIT_BRANCH}" "${GIT_ADDRESS}" .
fi

# Reinstall must rebuild code without deleting app state. data/ is gitignored.
rm -rf node_modules dist dist-server

# The egg sets NODE_ENV=production, which would make npm ci skip vite/esbuild.
echo "Installing dependencies..."
npm ci --include=dev --no-audit --no-fund

echo "Building SPA (dist) and server bundle (dist-server)..."
npm run build

# The server process runs as the node's UID/GID (set this to 1000/1000 so it
# can write the CIFS library on /raid2), not as root.
mkdir -p data
chmod 777 data
chmod -R a+rX dist dist-server public node_modules package.json package-lock.json pterodactyl/start.sh

echo "Install complete. Start the server and open the allocated port."
