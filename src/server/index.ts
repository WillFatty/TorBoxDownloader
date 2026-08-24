import { existsSync, readFileSync } from "fs";
import path from "path";
import { serve } from "@hono/node-server";
import { createApp } from "@/server/app";

// Minimal .env loader (Next used to do this automatically).
const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

if (process.env.NODE_ENV !== "production") {
  process.env.NODE_ENV = "development";
}

const port = Number(process.env.PORT) || 3000;
const distDir = path.resolve(process.cwd(), "dist");

const server = serve({ fetch: createApp(distDir).fetch, port });
server.once("listening", () => {
  console.log(`torbox-downloader listening on http://localhost:${port}`);
});
