
import {
  createSessionToken,
  getConfiguredPassword,
  passwordsMatch,
} from "@/lib/auth";
import { sessionSetCookie } from "@/server/http";

export async function POST(request: Request) {
  const expected = getConfiguredPassword();

  let password = "";
  try {
    const body = (await request.json()) as { password?: string };
    password = body.password || "";
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!passwordsMatch(password, expected)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = createSessionToken();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": sessionSetCookie(
        token,
        process.env.NODE_ENV === "production",
      ),
    },
  });
}
