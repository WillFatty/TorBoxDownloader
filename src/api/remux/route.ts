
import { listRemuxEntries } from "@/lib/remux-progress";

export async function GET() {
  return Response.json({ entries: listRemuxEntries() });
}
