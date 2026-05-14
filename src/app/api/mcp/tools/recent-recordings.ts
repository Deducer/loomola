import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { recentRecordings } from "@/lib/recordings/queries";
import { getMcpOwnerId } from "./owner";
import { jsonContent, toIso } from "./shared";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
  daysBack: z.number().int().min(1).max(365).default(30),
});

export function registerRecentRecordingsTool(server: McpServer): void {
  server.registerTool(
    "loomola_recent_recordings",
    {
      title: "Recent Loomola recordings",
      description: "List recent video recordings from Loomola.",
      inputSchema,
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const items = await recentRecordings({
        ownerId,
        limit: input.limit,
        daysBack: input.daysBack,
      });

      return jsonContent({
        recordings: items.map((item) => ({
          id: item.id,
          slug: item.slug,
          title: item.title,
          summary: item.summary ?? "",
          durationSeconds: item.durationSeconds,
          createdAt: toIso(item.createdAt),
          shareUrl: item.shareUrl,
          thumbnail: item.thumbnailUrl,
        })),
      });
    }
  );
}
