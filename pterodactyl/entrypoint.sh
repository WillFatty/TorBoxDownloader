#!/bin/bash
# Pterodactyl startup entrypoint — mounts SMB, optional git pull, starts the app.
set -euo pipefail

cd /home/container

DATA_DIR="${DATA_DIR:-/home/container/data}"
SETTINGS_PATH="${SETTINGS_PATH:-${DATA_DIR}/settings.json}"
JOBS_PATH="${JOBS_PATH:-${DATA_DIR}/jobs.json}"
PORT="${SERVER_PORT:-3000}"

mkdir -p "${DATA_DIR}"
export DATA_DIR SETTINGS_PATH JOBS_PATH
export NODE_ENV=production
export HOSTNAME=0.0.0.0
export PORT

is_true() {
  case "${1,,}" in
    1 | true | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

mount_smb() {
  if ! is_true "${SMB_ENABLED:-0}"; then
    return 0
  fi

  local server="${SMB_SERVER:-}"
  local share="${SMB_SHARE:-}"
  local mount_point="${SMB_MOUNT_POINT:-/raid2}"
  local username="${SMB_USERNAME:-}"
  local password="${SMB_PASSWORD:-}"

  if [ -z "${server}" ] || [ -z "${share}" ]; then
    echo "[smb] SMB_ENABLED but SMB_SERVER or SMB_SHARE is missing."
    exit 1
  fi

  mkdir -p "${mount_point}"

  if mountpoint -q "${mount_point}"; then
    echo "[smb] ${mount_point} already mounted (host bind or prior mount)."
    return 0
  fi

  if [ "$(id -u)" -ne 0 ]; then
    echo "[smb] Container is not root — cannot run mount.cifs inside Pterodactyl."
    echo "[smb] Mount //${server}/${share} on the Wings host (fstab) and add a Panel Mount:"
    echo "[smb]   Host: /raid2  →  Container: ${mount_point}"
    echo "[smb] Then set SMB_ENABLED=0, or leave enabled if the bind mount is already present."
    if [ -n "$(ls -A "${mount_point}" 2>/dev/null)" ]; then
      echo "[smb] ${mount_point} has content — continuing with bind mount."
      return 0
    fi
    exit 1
  fi

  if [ -z "${username}" ]; then
    echo "[smb] SMB_USERNAME is required for in-container mount."
    exit 1
  fi

  local cred_file="/tmp/.smbcredentials"
  {
    printf 'username=%s\n' "${username}"
    printf 'password=%s\n' "${password}"
    if [ -n "${SMB_DOMAIN:-}" ]; then
      printf 'domain=%s\n' "${SMB_DOMAIN}"
    fi
  } > "${cred_file}"
  chmod 600 "${cred_file}"

  local opts="credentials=${cred_file},iocharset=utf8,vers=3.0,uid=1000,gid=1000,file_mode=0775,dir_mode=0775"

  echo "[smb] Mounting //${server}/${share} -> ${mount_point}"
  if ! mount -t cifs "//${server}/${share}" "${mount_point}" -o "${opts}"; then
    echo "[smb] Mount failed. See pterodactyl/README.md (host bind mount or Wings caps)."
    exit 1
  fi
}

git_update() {
  if ! is_true "${GITHUB_AUTO_PULL:-0}"; then
    return 0
  fi

  if [ ! -d .git ]; then
    echo "[git] No .git directory — skipping auto-pull."
    return 0
  fi

  local branch="${GITHUB_BRANCH:-main}"
  local repo="${GITHUB_REPO:-https://github.com/WillFatty/TorBoxDownloader.git}"

  if [ -n "${GITHUB_TOKEN:-}" ]; then
    git remote set-url origin "https://${GITHUB_TOKEN}@${repo#https://}" 2>/dev/null || true
  else
    git remote set-url origin "${repo}" 2>/dev/null || true
  fi

  echo "[git] Pulling origin/${branch}..."
  git fetch origin "${branch}" --depth 1
  git reset --hard "origin/${branch}"
  git clean -fd

  if is_true "${GITHUB_REBUILD_ON_PULL:-1}"; then
    echo "[git] Rebuilding after pull..."
    npm ci
    npm run build
    mkdir -p .next/standalone/.next
    cp -a .next/static .next/standalone/.next/static
    cp -a public .next/standalone/public
  fi
}

start_app() {
  local server_js=".next/standalone/server.js"

  if [ ! -f "${server_js}" ]; then
    echo "[app] ${server_js} not found. Reinstall the server from the panel."
    exit 1
  fi

  echo "[app] Starting TorBox Downloader on 0.0.0.0:${PORT}"
  cd .next/standalone
  exec node server.js
}

mount_smb
git_update
start_app
