import { NextResponse } from "next/server";
import { applyAllNamingFixes, applyNamingFix } from "@/lib/library-fix";
import type { MediaType } from "@/lib/types";

function parseEpisodeTitles(body: unknown): Record<string, string> {
  const episodeTitles: Record<string, string> = {};
  if (body && typeof body === "object") {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) {
        episodeTitles[key] = value.trim();
      }
    }
  }
  return episodeTitles;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      type?: unknown;
      folder?: unknown;
      issueCode?: unknown;
      file?: unknown;
      canonicalName?: unknown;
      canonicalYear?: unknown;
      episodeTitles?: unknown;
      fixAll?: unknown;
      issues?: unknown;
    };

    const type = body.type === "series" ? "series" : "movie";
    const folder = typeof body.folder === "string" ? body.folder.trim() : "";
    const canonicalName =
      typeof body.canonicalName === "string" ? body.canonicalName.trim() : "";

    if (!folder || !canonicalName) {
      return NextResponse.json(
        { error: "folder and canonicalName are required" },
        { status: 400 },
      );
    }

    const episodeTitles = parseEpisodeTitles(body.episodeTitles);
    const canonicalYear =
      typeof body.canonicalYear === "string" ? body.canonicalYear : null;

    if (body.fixAll === true) {
      const issues: Array<{ issueCode: string; file?: string }> = [];
      if (Array.isArray(body.issues)) {
        for (const entry of body.issues) {
          if (!entry || typeof entry !== "object") continue;
          const row = entry as Record<string, unknown>;
          const issueCode =
            typeof row.issueCode === "string" ? row.issueCode.trim() : "";
          if (!issueCode) continue;
          issues.push({
            issueCode,
            file: typeof row.file === "string" ? row.file : undefined,
          });
        }
      }

      const result = await applyAllNamingFixes({
        type: type as MediaType,
        folder,
        canonicalName,
        canonicalYear,
        episodeTitles,
        issues,
      });

      return NextResponse.json(result);
    }

    const issueCode =
      typeof body.issueCode === "string" ? body.issueCode.trim() : "";
    if (!issueCode) {
      return NextResponse.json(
        { error: "issueCode is required" },
        { status: 400 },
      );
    }

    const result = await applyNamingFix({
      type: type as MediaType,
      folder,
      issueCode,
      file: typeof body.file === "string" ? body.file : undefined,
      canonicalName,
      canonicalYear,
      episodeTitles,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fix failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
