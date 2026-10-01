import { AUTH_COOKIE } from "@/lib/auth";

export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
}

/** Serialize a Set-Cookie header value (RFC 6265, no external deps). */
export function serializeCookie(
  name: string,
  value: string,
  opts: CookieOptions = {},
): string {
  const parts = [`${name}=${value}`, "Path=/"];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite[0].toUpperCase()}${opts.sameSite.slice(1)}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** True when the browser connection is HTTPS, including behind a reverse proxy. */
export function requestIsHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim().toLowerCase() === "https";
  }
  return new URL(request.url).protocol === "https:";
}

export function sessionSetCookie(token: string, secure: boolean): string {
  return serializeCookie(AUTH_COOKIE, token, {
    maxAge: 60 * 60 * 24 * 14,
    httpOnly: true,
    sameSite: "lax",
    secure,
  });
}

export function clearSessionSetCookie(secure: boolean): string {
  return serializeCookie(AUTH_COOKIE, "", {
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure,
  });
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}
