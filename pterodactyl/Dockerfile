# Custom Pterodactyl image for TorBox Downloader.
# Build from repo root:
#   docker build -f pterodactyl/Dockerfile -t torbox-downloader:latest .
#
# Push to your registry and set the image in the egg (or panel Docker Images).

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        cifs-utils \
        curl \
        git \
        gosu \
    && rm -rf /var/lib/apt/lists/*

# Match SMB mount uid/gid (uid=1000,gid=1000 in fstab).
RUN groupadd -g 1000 container \
    && useradd -u 1000 -g 1000 -m -d /home/container -s /bin/bash container

COPY pterodactyl/entrypoint.sh /opt/torbox/entrypoint.sh
RUN chmod +x /opt/torbox/entrypoint.sh

WORKDIR /home/container
EXPOSE 3000

# Wings overrides CMD with the egg startup command (/opt/torbox/entrypoint.sh).
# Do not set USER here — Pterodactyl assigns the runtime UID.
