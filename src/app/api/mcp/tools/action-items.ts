import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { openActionItems } from "@/lib/action-items/queries";
import { getMcpOwnerId } from "./owner";
import { jsonContent, toIso } from "./shared";

const inputSchema = z.object({
  status: z.enum(["open", "done", "any"]).default("open"),
  person: z.string().optional(),
  folder: z.string().optional(),
  daysBack: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(100).default(25),
});

export function registerActionItemsTool(server: McpServer): void {
  server.registerTool(
    "loomola_action_items",
    {
      title: "Loomola action items",
      description: "List action items extracted from Loomola recordings and meetings.",
      inputSchema,
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const items = await openActionItems({
        ownerId,
        status: input.status,
        person: input.person,
        folder: input.folder,
        daysBack: input.daysBack,
        limit: input.limit,
      });

      return jsonContent({
        actionItems: items.map((item) => ({
          id: item.id,
          text: item.text,
          status: item.status,
          mediaId: item.mediaId,
          mediaTitle: item.mediaTitle,
          mediaShareUrl: item.mediaShareUrl,
          deepLink: item.deepLink,
          timestampSec: item.timestampSec,
          attributedTo: item.attributedTo,
          createdAt: toIso(item.createdAt),
        })),
      });
    }
  );
}
