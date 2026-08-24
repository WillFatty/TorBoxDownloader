import type { Hono } from "hono";

export type RouteHandler = (
  request: Request,
  context: { params: Record<string, string> },
) => Promise<Response> | Response;

/**
 * Mount a Next-style route handler module ({ GET, POST, ... } exports)
 * onto a Hono path. Params are passed as a resolved object; the async
 * `context.params` shape of the original handlers is preserved.
 */
function mount(
  app: Hono,
  method: "get" | "post" | "put" | "delete",
  path: string,
  mod: Record<string, unknown>,
) {
  const handler = mod[method.toUpperCase()];
  if (typeof handler !== "function") return;
  app.on(method.toUpperCase(), path, async (c) => {
    const params = c.req.param();
    return (handler as RouteHandler)(c.req.raw, { params });
  });
}

interface RouteDef {
  path: string;
  mod: Record<string, unknown>;
}

export function registerRoutes(app: Hono, routes: RouteDef[]) {
  for (const { path, mod } of routes) {
    for (const method of ["get", "post", "put", "delete"] as const) {
      mount(app, method, path, mod);
    }
  }
}
