const fs = require("fs");
const path = require("path");

const dir = __dirname;
for (const name of ["install.sh", "start.sh"]) {
  const file = path.join(dir, name);
  let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (!text.endsWith("\n")) text += "\n";
  fs.writeFileSync(file, text);
}

const script = fs.readFileSync(path.join(dir, "install.sh"), "utf8");

const egg = {
  _comment:
    "TorBox Downloader Pterodactyl egg. Import via Admin -> Nests -> Import Egg. scripts.installation.script is a copy of pterodactyl/install.sh. The panel cannot declare mounts; host /raid2 must be a Wings allowed mount and a panel mount with target /raid2 so MOVIES_PATH and TV_SHOWS_PATH work.",
  meta: {
    version: "PTDL_v2",
    update_url:
      "https://raw.githubusercontent.com/WillFatty/TorBoxDownloader/main/pterodactyl/egg.json",
  },
  exported_at: "2026-10-01T00:00:00+00:00",
  name: "TorBox Downloader",
  author: "willfatty@users.noreply.github.com",
  description:
    "Search movies/TV, pull streams from Comet, and download them with TorBox into a Jellyfin library. The container must bind-mount the Wings host path /raid2 to /raid2 (read-write) or MOVIES_PATH and TV_SHOWS_PATH cannot see the library. The Node 22 yolk includes ffmpeg. Set the node UID/GID to 1000/1000 so downloads can be written to the CIFS share.",
  features: null,
  docker_images: {
    "ghcr.io/ptero-eggs/yolks:nodejs_22": "ghcr.io/ptero-eggs/yolks:nodejs_22",
  },
  file_denylist: [".git", "node_modules"],
  startup: "bash pterodactyl/start.sh",
  config: {
    files: "{}",
    startup: '{\n    "done": "listening on"\n}',
    logs: '{\n    "lines": 150\n}',
    stop: "^C",
  },
  scripts: {
    installation: {
      container: "ghcr.io/ptero-eggs/yolks:nodejs_22",
      entrypoint: "bash",
      script,
    },
  },
  variables: [
    {
      name: "Git repository",
      description:
        "Repository cloned on install. Reinstall fetches this branch again and leaves data/ in place.",
      env_variable: "GIT_ADDRESS",
      default_value: "https://github.com/WillFatty/TorBoxDownloader",
      user_viewable: true,
      user_editable: true,
      rules: "required|string|max:255",
    },
    {
      name: "Git branch",
      description:
        "Branch or tag to clone. Use a tag when you want reinstall to pin a release.",
      env_variable: "GIT_BRANCH",
      default_value: "main",
      user_viewable: true,
      user_editable: true,
      rules: "required|string|max:64",
    },
    {
      name: "TorBox API Key",
      description:
        "From https://torbox.app/settings. Required for downloads and the TorBox cache badges.",
      env_variable: "TORBOX_API_KEY",
      default_value: "",
      user_viewable: true,
      user_editable: true,
      rules: "required|string|min:8|max:255",
    },
    {
      name: "Site Password",
      description: "Password for the web UI login page.",
      env_variable: "SITE_PASSWORD",
      default_value: "",
      user_viewable: true,
      user_editable: true,
      rules: "required|string|min:8|max:255",
    },
    {
      name: "Movies Path",
      description:
        "Movie library folder as seen inside the container. Host /raid2 is mounted at /raid2, so this is the host path, e.g. /raid2/Jellyfin/Movies.",
      env_variable: "MOVIES_PATH",
      default_value: "/raid2/Jellyfin/Movies",
      user_viewable: true,
      user_editable: true,
      rules: "required|string|regex:#^/[A-Za-z0-9._/-]*$#",
    },
    {
      name: "TV Shows Path",
      description:
        "Series library folder as seen inside the container. Host /raid2 is mounted at /raid2, so this is the host path, e.g. /raid2/Jellyfin/TV-Shows.",
      env_variable: "TV_SHOWS_PATH",
      default_value: "/raid2/Jellyfin/TV-Shows",
      user_viewable: true,
      user_editable: true,
      rules: "required|string|regex:#^/[A-Za-z0-9._/-]*$#",
    },
    {
      name: "Comet URL",
      description:
        "Comet instance base URL, no trailing slash. Public instances rate-limit; self-host for heavy use.",
      env_variable: "COMET_URL",
      default_value: "https://comet.elfhosted.com",
      user_viewable: true,
      user_editable: true,
      rules: "nullable|string|max:255",
    },
    {
      name: "OMDb API Key",
      description:
        "Optional, free at https://www.omdbapi.com/apikey.aspx. Adds Rotten Tomatoes and Metacritic scores. The IMDb rating shows without it.",
      env_variable: "OMDB_API_KEY",
      default_value: "",
      user_viewable: true,
      user_editable: true,
      rules: "nullable|string|max:255",
    },
    {
      name: "Jellyfin URL",
      description:
        "Optional. Jellyfin base URL used for metadata pushes and library refreshes.",
      env_variable: "JELLYFIN_URL",
      default_value: "",
      user_viewable: true,
      user_editable: true,
      rules: "nullable|string|max:255",
    },
    {
      name: "Jellyfin API Key",
      description: "Optional. Jellyfin API key for the URL above.",
      env_variable: "JELLYFIN_API_KEY",
      default_value: "",
      user_viewable: true,
      user_editable: true,
      rules: "nullable|string|max:255",
    },
    {
      name: "Storage Backend",
      description:
        "Where settings, jobs, and caches live: redis or file. file writes JSON under /home/container/data.",
      env_variable: "STORAGE_BACKEND",
      default_value: "redis",
      user_viewable: true,
      user_editable: true,
      rules: "required|in:redis,file",
    },
    {
      name: "Redis Host",
      description: "Redis host. Used when STORAGE_BACKEND=redis.",
      env_variable: "REDIS_HOST",
      default_value: "192.168.0.208",
      user_viewable: true,
      user_editable: true,
      rules: "nullable|string|max:255",
    },
    {
      name: "Redis Port",
      description: "Redis port. Used when STORAGE_BACKEND=redis.",
      env_variable: "REDIS_PORT",
      default_value: "6379",
      user_viewable: true,
      user_editable: true,
      rules: "nullable|integer|min:1|max:65535",
    },
    {
      name: "Redis Password",
      description: "Optional Redis password.",
      env_variable: "REDIS_PASSWORD",
      default_value: "",
      user_viewable: true,
      user_editable: true,
      rules: "nullable|string|max:255",
    },
    {
      name: "Redis URL",
      description:
        "Optional full URL. Takes precedence over host/port/password (redis://user:pass@host:6379).",
      env_variable: "REDIS_URL",
      default_value: "",
      user_viewable: true,
      user_editable: true,
      rules: "nullable|string|max:255",
    },
    {
      name: "Auth Secret",
      description:
        "Optional. Separate cookie signing secret. Defaults to SITE_PASSWORD.",
      env_variable: "AUTH_SECRET",
      default_value: "",
      user_viewable: false,
      user_editable: true,
      rules: "nullable|string|max:255",
    },
    {
      name: "Node Environment",
      description:
        "Keep this at production. The built SPA is only served in production mode.",
      env_variable: "NODE_ENV",
      default_value: "production",
      user_viewable: false,
      user_editable: true,
      rules: "required|in:production",
    },
  ],
};

fs.writeFileSync(path.join(dir, "egg.json"), JSON.stringify(egg, null, 4) + "\n");

const round = JSON.parse(fs.readFileSync(path.join(dir, "egg.json"), "utf8"));
if (round.scripts.installation.script !== script) {
  console.error("embedded script mismatch");
  process.exit(1);
}
console.log(
  "egg.json ok",
  round.variables.length,
  "variables",
  script.split("\n").length,
  "script lines",
);
