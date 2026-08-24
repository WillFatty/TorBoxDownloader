import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { Readable } from "stream";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
};

function contentType(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/** Serve a file from distDir; SPA-fallback unknown routes to index.html. */
export function serveStaticFile(request: Request, distDir: string): Response {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  const resolved = path.resolve(distDir, `.${pathname}`);
  const withinDist = resolved.startsWith(path.resolve(distDir));
  const assetLike = pathname.startsWith("/assets/");

  if (
    !withinDist ||
    !existsSync(resolved) ||
    !statSync(resolved).isFile()
  ) {
    // Unknown asset requests 404; unknown page routes fall back to the SPA.
    if (assetLike || pathname.includes(".")) {
      return new Response("Not found", { status: 404 });
    }
    return sendFile(path.join(distDir, "index.html"));
  }
  return sendFile(resolved);
}

function sendFile(filePath: string): Response {
  try {
    const stat = statSync(filePath);
    const type = contentType(filePath);
    const stream = Readable.toWeb(
      createReadStream(filePath),
    ) as unknown as BodyInit;
    return new Response(stream, {
        status: 200,
        headers: {
          "content-type": type,
          "content-length": String(stat.size),
          "cache-control": filePath.includes(`${path.sep}assets${path.sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
