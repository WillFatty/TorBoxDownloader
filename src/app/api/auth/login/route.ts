import { NextResponse } from "next/server";
import {
  createSessionToken,
  getConfiguredPassword,
  passwordsMatch,
  sessionCookieOptions,
} from "@/lib/auth";

export async function POST(request: Request) {
  const expected = getConfiguredPassword();

  let password = "";
  try {
    const body = (await request.json()) as { password?: string };
    password = body.password || "";
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!passwordsMatch(password, expected)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = createSessionToken();
  const res = NextResponse.json({ ok: true });
  const cookie = sessionCookieOptions(token);
  res.cookies.set(cookie);
  return res;
}
