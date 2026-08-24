
import { downloadManager } from "@/lib/download-manager";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await downloadManager.cancel(id);
  if (result === "missing") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (result === "inactive") {
    return Response.json(
      { error: "Download is not active" },
      { status: 409 },
    );
  }
  return Response.json({ ok: true });
}
