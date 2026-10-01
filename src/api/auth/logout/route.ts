import { clearSessionSetCookie, requestIsHttps } from "@/server/http";

export function POST(request: Request) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": clearSessionSetCookie(requestIsHttps(request)),
    },
  });
}
