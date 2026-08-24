
import { downloadManager } from "@/lib/download-manager";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const job = await downloadManager.retry(id);
    if (!job) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ job });
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to retry download",
      },
      { status: 400 },
    );
  }
}
