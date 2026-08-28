import { Hono } from "hono";
import { verifySessionToken, AUTH_COOKIE } from "@/lib/auth";
import { readCookie } from "@/server/http";
import { registerRoutes } from "@/server/routes";
import { serveStaticFile } from "@/server/static";

import * as artwork from "@/api/artwork/route";
import * as authLogin from "@/api/auth/login/route";
import * as authLogout from "@/api/auth/logout/route";
import * as downloads from "@/api/downloads/route";
import * as downloadById from "@/api/downloads/[id]/route";
import * as downloadCancel from "@/api/downloads/[id]/cancel/route";
import * as downloadRetry from "@/api/downloads/[id]/retry/route";
import * as filename from "@/api/filename/route";
import * as jellyfinMetadata from "@/api/jellyfin/metadata/route";
import * as jellyfinRefresh from "@/api/jellyfin/refresh/route";
import * as library from "@/api/library/route";
import * as libraryEnglishOnly from "@/api/library/english-only/route";
import * as libraryEnglishSubs from "@/api/library/english-subs/route";
import * as libraryFix from "@/api/library/fix/route";
import * as libraryProbe from "@/api/library/probe/route";
import * as magnet from "@/api/magnet/route";
import * as meta from "@/api/meta/route";
import * as ratings from "@/api/ratings/route";
import * as remux from "@/api/remux/route";
import * as search from "@/api/search/route";
import * as settings from "@/api/settings/route";
import * as streams from "@/api/streams/route";

export function createApp(distDir: string) {
  const app = new Hono();

  // ---- Auth gate (replaces src/middleware.ts) -----------------------------
  // Registered before any routes so it wraps every handler below.

  const isPublic = (path: string) =>
    path === "/login" || path.startsWith("/assets/") || path === "/favicon.ico";

  app.use("*", async (c, next) => {
    const path = new URL(c.req.raw.url).pathname;

    if (path.startsWith("/api/")) {
      if (
        path.startsWith("/api/auth") ||
        (await verifySessionToken(readCookie(c.req.raw, AUTH_COOKIE)))
      ) {
        return next();
      }
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isProduction() && !path.startsWith("/assets")) {
      // vite dev serves the SPA itself; only the API is proxied here.
      return next();
    }

    const authenticated = await verifySessionToken(
      readCookie(c.req.raw, AUTH_COOKIE),
    );
    if (authenticated || isPublic(path)) {
      return serveStaticFile(c.req.raw, distDir);
    }
    const url = new URL(c.req.raw.url);
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return Response.redirect(url.toString(), 307);
  });

  // ---- API ----------------------------------------------------------------

  registerRoutes(app, [
    { path: "/api/artwork", mod: artwork },
    { path: "/api/auth/login", mod: authLogin },
    { path: "/api/auth/logout", mod: authLogout },
    { path: "/api/downloads", mod: downloads },
    { path: "/api/downloads/:id", mod: downloadById },
    { path: "/api/downloads/:id/cancel", mod: downloadCancel },
    { path: "/api/downloads/:id/retry", mod: downloadRetry },
    { path: "/api/filename", mod: filename },
    { path: "/api/jellyfin/metadata", mod: jellyfinMetadata },
    { path: "/api/jellyfin/refresh", mod: jellyfinRefresh },
    { path: "/api/library", mod: library },
    { path: "/api/library/english-only", mod: libraryEnglishOnly },
    { path: "/api/library/english-subs", mod: libraryEnglishSubs },
    { path: "/api/library/fix", mod: libraryFix },
    { path: "/api/library/probe", mod: libraryProbe },
    { path: "/api/magnet", mod: magnet },
    { path: "/api/meta", mod: meta },
    { path: "/api/ratings", mod: ratings },
    { path: "/api/remux", mod: remux },
    { path: "/api/search", mod: search },
    { path: "/api/settings", mod: settings },
    { path: "/api/streams", mod: streams },
  ]);

  app.all("*", (c) => serveStaticFile(c.req.raw, distDir));

  return app;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
