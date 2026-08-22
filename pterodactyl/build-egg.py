#!/usr/bin/env python3
"""Build pterodactyl/egg-torbox-downloader.json from install.sh."""

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INSTALL = (ROOT / "install.sh").read_text(encoding="utf-8")

STARTUP_CONFIG = json.dumps(
    {
        "done": "[app] Starting TorBox Downloader",
        "userInteraction": [],
    },
    separators=(",", ": "),
)

EGG = {
    "_comment": "DO NOT EDIT: regenerate with python3 pterodactyl/build-egg.py",
    "meta": {
        "version": "PTDL_v2",
        "update_url": None,
    },
    "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
    "name": "TorBox Downloader",
    "author": "WillFatty@users.noreply.github.com",
    "description": "Next.js TorBox/Jellyfin downloader. Optional CIFS SMB mount and GitHub auto-pull on startup.",
    "features": None,
    "docker_images": {
        "Node.js 22": "ghcr.io/pterodactyl/yolks:nodejs_22",
    },
    "file_denylist": [],
    "startup": "bash /home/container/pterodactyl/entrypoint.sh",
    "config": {
        "files": "{}",
        "startup": STARTUP_CONFIG,
        "logs": "{}",
        "stop": "^C",
    },
    "scripts": {
        "installation": {
            "script": INSTALL,
            "container": "ghcr.io/pterodactyl/yolks:nodejs_22",
            "entrypoint": "bash",
        },
    },
    "variables": [
        {
            "name": "GitHub Repository",
            "description": "Repository to clone on install and pull on startup.",
            "env_variable": "GITHUB_REPO",
            "default_value": "https://github.com/WillFatty/TorBoxDownloader.git",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|string",
            "field_type": "text",
        },
        {
            "name": "GitHub Branch",
            "description": "Branch to track for install and auto-pull.",
            "env_variable": "GITHUB_BRANCH",
            "default_value": "main",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|string|max:64",
            "field_type": "text",
        },
        {
            "name": "GitHub Auto Pull",
            "description": "Pull latest code from GitHub on each server start (1 = yes, 0 = no).",
            "env_variable": "GITHUB_AUTO_PULL",
            "default_value": "1",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|boolean",
            "field_type": "text",
        },
        {
            "name": "GitHub Rebuild On Pull",
            "description": "Run npm ci && npm run build after git pull (1 = yes, 0 = no).",
            "env_variable": "GITHUB_REBUILD_ON_PULL",
            "default_value": "1",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|boolean",
            "field_type": "text",
        },
        {
            "name": "GitHub Token",
            "description": "Optional PAT for private repos (leave empty for public).",
            "env_variable": "GITHUB_TOKEN",
            "default_value": "",
            "user_viewable": True,
            "user_editable": True,
            "rules": "nullable|string|max:255",
            "field_type": "text",
        },
        {
            "name": "SMB Enabled",
            "description": "Mount a CIFS/SMB share before starting (1 = yes, 0 = no). Requires SYS_ADMIN on Wings.",
            "env_variable": "SMB_ENABLED",
            "default_value": "0",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|boolean",
            "field_type": "text",
        },
        {
            "name": "SMB Server",
            "description": "SMB host/IP (without share path). Example: 192.168.0.234",
            "env_variable": "SMB_SERVER",
            "default_value": "192.168.0.234",
            "user_viewable": True,
            "user_editable": True,
            "rules": "nullable|string|max:255",
            "field_type": "text",
        },
        {
            "name": "SMB Share",
            "description": "Share name on the server. Example: big_pool",
            "env_variable": "SMB_SHARE",
            "default_value": "big_pool",
            "user_viewable": True,
            "user_editable": True,
            "rules": "nullable|string|max:255",
            "field_type": "text",
        },
        {
            "name": "SMB Mount Point",
            "description": "Local mount path inside the container. Example: /raid2",
            "env_variable": "SMB_MOUNT_POINT",
            "default_value": "/raid2",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|string|max:255",
            "field_type": "text",
        },
        {
            "name": "SMB Username",
            "description": "CIFS username.",
            "env_variable": "SMB_USERNAME",
            "default_value": "",
            "user_viewable": True,
            "user_editable": True,
            "rules": "nullable|string|max:255",
            "field_type": "text",
        },
        {
            "name": "SMB Password",
            "description": "CIFS password.",
            "env_variable": "SMB_PASSWORD",
            "default_value": "",
            "user_viewable": True,
            "user_editable": True,
            "rules": "nullable|string|max:255",
            "field_type": "text",
        },
        {
            "name": "SMB Domain",
            "description": "Optional Windows domain/workgroup.",
            "env_variable": "SMB_DOMAIN",
            "default_value": "",
            "user_viewable": True,
            "user_editable": True,
            "rules": "nullable|string|max:255",
            "field_type": "text",
        },
        {
            "name": "Movies Path",
            "description": "Jellyfin movies folder (usually under the SMB mount).",
            "env_variable": "MOVIES_PATH",
            "default_value": "/raid2/Jellyfin/Movies",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|string|max:512",
            "field_type": "text",
        },
        {
            "name": "TV Shows Path",
            "description": "Jellyfin TV shows folder (usually under the SMB mount).",
            "env_variable": "TV_SHOWS_PATH",
            "default_value": "/raid2/Jellyfin/TV-Shows",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|string|max:512",
            "field_type": "text",
        },
        {
            "name": "TorBox API Key",
            "description": "From https://torbox.app/settings",
            "env_variable": "TORBOX_API_KEY",
            "default_value": "",
            "user_viewable": True,
            "user_editable": True,
            "rules": "nullable|string|max:512",
            "field_type": "text",
        },
        {
            "name": "Comet URL",
            "description": "Comet instance base URL (no trailing slash).",
            "env_variable": "COMET_URL",
            "default_value": "https://comet.elfhosted.com",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|string|max:512",
            "field_type": "text",
        },
        {
            "name": "Site Password",
            "description": "Website login password (required).",
            "env_variable": "SITE_PASSWORD",
            "default_value": "changeme",
            "user_viewable": True,
            "user_editable": True,
            "rules": "required|string|min:4|max:255",
            "field_type": "text",
        },
        {
            "name": "Auth Secret",
            "description": "Optional cookie signing secret (defaults to Site Password).",
            "env_variable": "AUTH_SECRET",
            "default_value": "",
            "user_viewable": True,
            "user_editable": True,
            "rules": "nullable|string|max:255",
            "field_type": "text",
        },
    ],
}

out = ROOT / "egg-torbox-downloader.json"
out.write_text(json.dumps(EGG, indent=2) + "\n", encoding="utf-8")

# Sanity checks matching Pterodactyl import rules.
assert "@" in EGG["author"], "author must be an email address"
assert isinstance(EGG["config"]["startup"], str), "config.startup must be a JSON string"
json.loads(EGG["config"]["startup"])
json.loads(EGG["config"]["files"])
json.loads(EGG["config"]["logs"])

print(f"Wrote {out}")
