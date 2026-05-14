import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { recentNotes } from "@/lib/notes/queries";
import { getMcpOwnerId } from "./owner";
import { jsonContent, toIso } from "./shared";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
  daysBack: z.number().int().min(1).max(365).default(30),
});

export function registerRecentMeetingsTool(server: McpServer): void {
  server.registerTool(
    "loomola_recent_meetings",
    {
      title: "Recent Loomola meetings",
      description: "List recent audio meeting notes from Loomola.",
      inputSchema,
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const items = await recentNotes({
        ownerId,
        limit: input.limit,
        daysBack: input.daysBack,
      });

      return jsonContent({
        meetings: items.map((item) => ({
          id: item.id,
          slug: item.slug,
          title: item.title,
          summary: item.summary ?? "",
          durationSeconds: item.durationSeconds,
          attendees: item.attendees.map((attendee) => attendee.name),
          folderName: item.folderName,
          createdAt: toIso(item.createdAt),
          noteUrl: item.shareUrl,
        })),
      });
    }
  );
}
