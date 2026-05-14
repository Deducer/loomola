import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { getEmbeddingAdapter } from "@/lib/embeddings/openai";
import { searchMedia } from "@/lib/recordings/queries";
import { getMcpOwnerId } from "./owner";
import { jsonContent, toIso } from "./shared";

const inputSchema = z.object({
  query: z.string().min(3).max(500),
  limit: z.number().int().min(1).max(20).default(8),
  type: z.enum(["video", "audio", "any"]).default("any"),
  since: z.string().datetime().optional(),
});

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    "loomola_search",
    {
      title: "Search Loomola",
      description: "Semantic search across Loomola recordings and meeting notes.",
      inputSchema,
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const adapter = getEmbeddingAdapter();
      const [embedding] = await adapter.embed([input.query]);
      const result = await searchMedia({
        ownerId,
        query: input.query,
        limit: input.limit,
        type: input.type,
        since: input.since,
        embedding,
      });

      return jsonContent({
        results: result.results.map((item) => ({
          id: item.id,
          slug: item.slug,
          type: item.type,
          title: item.title,
          summary: item.summary ?? "",
          createdAt: toIso(item.createdAt),
          similarity: item.similarity,
          shareUrl: item.shareUrl,
        })),
        query: input.query,
        totalCandidates: result.totalCandidates,
      });
    }
  );
}
