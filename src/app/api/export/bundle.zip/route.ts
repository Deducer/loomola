import { NextResponse } from "next/server";
import { listExportBundleMedia } from "@/db/queries/export-bundle";
import { buildBundleMarkdown, bundleEntryPath } from "@/lib/export/bundle-markdown";
import { createZip } from "@/lib/export/zip";
import { enableGranola } from "@/lib/feature-flags";
import { hasIntegrationToken } from "@/lib/integration-auth";
import { requireAuth } from "@/lib/require-auth";
import { getMcpOwnerId } from "@/app/api/mcp/tools/owner";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (!enableGranola()) return granolaNotFound();

  const url = new URL(request.url);
  const parsed = parseBundleParams(url);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // The integration token is instance-wide; leaving ownerId undefined exported
  // every user's data on multi-user instances. Pin to the MCP owner account
  // (MCP_OWNER_ID / MCP_OWNER_EMAIL, or the sole user).
  let ownerId: string;
  if (hasIntegrationToken(request)) {
    try {
      ownerId = await getMcpOwnerId();
    } catch {
      return granolaNotFound();
    }
  } else {
    ownerId = (await requireAuth(request)).id;
  }
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  const items = await listExportBundleMedia({ ownerId, ...parsed });
  const zip = createZip(
    items.map((item) => ({
      path: bundleEntryPath(item),
      data: buildBundleMarkdown(item, appBaseUrl),
      modifiedAt: item.media.updatedAt,
    }))
  );

  return new Response(new Blob([zip], { type: "application/zip" }), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${bundleFilename()}"`,
      "cache-control": "private, no-store",
    },
  });
}

function parseBundleParams(url: URL):
  | { type?: "audio" | "video"; since?: Date; folderId?: string }
  | { error: string } {
  const type = url.searchParams.get("type");
  let mediaType: "audio" | "video" | undefined;
  if (type && type !== "audio" && type !== "video") {
    return { error: "invalid_type" };
  }
  if (type === "audio" || type === "video") mediaType = type;

  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  if (sinceParam && Number.isNaN(since?.getTime())) {
    return { error: "invalid_since" };
  }

  return {
    ...(mediaType ? { type: mediaType } : {}),
    ...(since ? { since } : {}),
    ...(url.searchParams.get("folder_id")
      ? { folderId: url.searchParams.get("folder_id")! }
      : {}),
  };
}

function bundleFilename(): string {
  return `loomola-export-${new Date().toISOString().slice(0, 10)}.zip`;
}
