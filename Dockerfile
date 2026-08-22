# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner

# Official node image already ships UID/GID 1000 as user "node".
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SETTINGS_PATH=/app/data/settings.json \
    JOBS_PATH=/app/data/jobs.json

# ffprobe is used to read audio / subtitle languages from library files.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Bundled probe/remux binaries (fallback when PATH ffmpeg is missing).
COPY --from=build --chown=node:node /app/node_modules/ffmpeg-static ./node_modules/ffmpeg-static
COPY --from=build --chown=node:node /app/node_modules/@ffprobe-installer ./node_modules/@ffprobe-installer

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000
CMD ["node", "server.js"]
