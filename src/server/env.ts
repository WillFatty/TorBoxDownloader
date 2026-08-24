import { existsSync, readFileSync } from "fs";
import path from "path";

// Minimal .env loader (Next used to do this automatically).
// Imported first in src/server/index.ts so every later module sees these.
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
