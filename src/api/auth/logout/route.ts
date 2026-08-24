import { clearSessionSetCookie } from "@/server/http";

export function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": clearSessionSetCookie(
        process.env.NODE_ENV === "production",
      ),
    },
  });
}
