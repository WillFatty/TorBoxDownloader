import { NextResponse } from "next/server";
import { listRemuxEntries } from "@/lib/remux-progress";

export async function GET() {
  return NextResponse.json({ entries: listRemuxEntries() });
}
