import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { listStackForOwner, setStackOrder } from "@/db/queries/versions";
import { mediaShareUrl } from "@/lib/recordings/queries";
import { getMcpOwnerId } from "./owner";
import { findOwnedMedia } from "./lookup";
import { errorContent, jsonContent, toIso } from "./shared";

async function stackPayload(ownerId: string, recordingId: string) {
  const stack = await listStackForOwner(ownerId, recordingId);
  if (!stack) return null;
  const latest = stack.versions[stack.versions.length - 1];
  return {
    stacked: stack.groupId !== null,
    versions: stack.versions.map((v) => ({
      number: v.number,
      id: v.id,
      slug: v.slug,
      title: v.title,
      status: v.status,
      createdAt: toIso(v.createdAt),
      shareUrl: mediaShareUrl({ type: "video", slug: v.slug }),
      latest: v.id === latest?.id,
    })),
    compareUrl:
      stack.versions.length > 1 && latest
        ? `${mediaShareUrl({ type: "video", slug: latest.slug })}?compare=${stack.versions.length - 1}`
        : null,
  };
}

export function registerVersionTools(server: McpServer): void {
  server.registerTool(
    "loomola_list_versions",
    {
      title: "List a recording's versions",
      description:
        "List every version (draft) in the stack a video belongs to, oldest first, numbered v1..vN as on the share page, with each one's share URL and a compare link (previous vs latest side by side). A recording outside any stack is a stack of one. `recording` takes an id, slug or share URL of any version. Add versions with loomola_upload_begin { versionOf }.",
      inputSchema: z.object({ recording: z.string().min(3) }),
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const media = await findOwnedMedia(ownerId, input.recording);
      if (!media) return errorContent("not_found", `No recording matches "${input.recording}".`);
      const payload = await stackPayload(ownerId, media.id);
      if (!payload) return errorContent("not_found", `No recording matches "${input.recording}".`);
      return jsonContent(payload);
    }
  );

  server.registerTool(
    "loomola_set_version_order",
    {
      title: "Reorder a recording's versions",
      description:
        "Set the order of a version stack. `order` lists every version (ids, slugs or share URLs), first (v1) to last (latest). It must name each live version exactly once. The latest is what dashboards show.",
      inputSchema: z.object({
        recording: z.string().min(3),
        order: z.array(z.string().min(3)).min(2),
      }),
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const media = await findOwnedMedia(ownerId, input.recording);
      if (!media) return errorContent("not_found", `No recording matches "${input.recording}".`);
      const ids: string[] = [];
      for (const ref of input.order) {
        const row = await findOwnedMedia(ownerId, ref);
        if (!row) return errorContent("not_found", `No recording matches "${ref}".`);
        ids.push(row.id);
      }
      const result = await setStackOrder({ ownerId, recordingId: media.id, orderedIds: ids });
      if (!result.ok) {
        const message =
          result.error === "not_stacked"
            ? "That recording is not in a version stack."
            : result.error === "bad_order"
              ? "`order` must list every version in the stack exactly once (see loomola_list_versions)."
              : `No recording matches "${input.recording}".`;
        return errorContent(result.error, message);
      }
      return jsonContent({ ok: true, ...(await stackPayload(ownerId, media.id)) });
    }
  );
}
