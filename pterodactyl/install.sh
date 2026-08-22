#!/bin/bash
# Pterodactyl install script — runs in the install container (/mnt/server).
set -euo pipefail

cd /mnt/server

GITHUB_REPO="${GITHUB_REPO:-https://github.com/WillFatty/TorBoxDownloader.git}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

if [ -n "${GITHUB_TOKEN:-}" ]; then
  GIT_URL="https://${GITHUB_TOKEN}@${GITHUB_REPO#https://}"
else
  GIT_URL="${GITHUB_REPO}"
fi

if [ ! -d .git ]; then
  echo "Cloning ${GITHUB_REPO} (branch ${GITHUB_BRANCH})..."
  git clone --depth 1 --branch "${GITHUB_BRANCH}" "${GIT_URL}" .
else
  echo "Updating existing repository..."
  git remote set-url origin "${GIT_URL}" 2>/dev/null || true
  git fetch origin "${GITHUB_BRANCH}" --depth 1
  git reset --hard "origin/${GITHUB_BRANCH}"
  git clean -fd
fi

echo "Installing dependencies..."
npm ci

echo "Building Next.js (standalone)..."
npm run build

echo "Preparing standalone bundle..."
mkdir -p .next/standalone/.next
cp -a .next/static .next/standalone/.next/static
cp -a public .next/standalone/public

mkdir -p data
touch data/.keep

echo "Install complete."
