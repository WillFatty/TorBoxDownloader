import "./env";
import path from "path";
import { serve } from "@hono/node-server";
import { createApp } from "@/server/app";
import { storageBackend } from "@/lib/store";

const port = Number(process.env.PORT) || 3000;
const distDir = path.resolve(process.cwd(), "dist");

const server = serve({ fetch: createApp(distDir).fetch, port });
server.once("listening", () => {
  console.log(
    `torbox-downloader listening on http://localhost:${port} ` +
      `(storage: ${storageBackend()})`,
  );
});
