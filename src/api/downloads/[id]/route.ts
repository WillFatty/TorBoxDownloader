
import { downloadManager } from "@/lib/download-manager";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const job = await downloadManager.get(id);
  if (!job) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ job });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const removed = await downloadManager.remove(id);
  if (!removed) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
