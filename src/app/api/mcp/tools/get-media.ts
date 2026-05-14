import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { getMediaById } from "@/lib/recordings/queries";
import { getMcpOwnerId } from "./owner";
import { jsonContent, toIso } from "./shared";

const TRANSCRIPT_LIMIT = 30_000;

const includeSchema = z.enum([
  "transcript",
  "actionItems",
  "chapters",
  "comments",
  "attendees",
]);

const inputSchema = z.object({
  idOrSlug: z.string().min(3),
  include: z
    .array(includeSchema)
    .default(["transcript", "actionItems", "chapters"]),
});

type ActionItem = {
  text?: unknown;
  timestamp_sec?: unknown;
};

type Chapter = {
  title?: unknown;
  start_sec?: unknown;
};

function actionItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return (value as ActionItem[])
    .filter((item) => typeof item.text === "string")
    .map((item) => ({
      text: item.text as string,
      timestampSec:
        typeof item.timestamp_sec === "number" ? item.timestamp_sec : null,
    }));
}

function chapters(value: unknown) {
  if (!Array.isArray(value)) return [];
  return (value as Chapter[])
    .filter((item) => typeof item.title === "string")
    .map((item) => ({
      title: item.title as string,
      startSec: typeof item.start_sec === "number" ? item.start_sec : null,
    }));
}

export function registerGetMediaTool(server: McpServer): void {
  server.registerTool(
    "loomola_get_media",
    {
      title: "Get Loomola media",
      description: "Fetch one Loomola recording or meeting note by id or slug.",
      inputSchema,
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const details = await getMediaById({ ownerId, idOrSlug: input.idOrSlug });
      if (!details) {
        return jsonContent({ found: false, idOrSlug: input.idOrSlug });
      }

      const include = new Set(input.include);
      const transcriptText = details.transcript?.fullText ?? null;
      const truncatedTranscript =
        transcriptText && transcriptText.length > TRANSCRIPT_LIMIT
          ? transcriptText.slice(0, TRANSCRIPT_LIMIT)
          : transcriptText;

      return jsonContent({
        found: true,
        media: {
          id: details.media.id,
          slug: details.media.slug,
          type: details.media.type,
          title: details.title,
          summary: details.summary ?? "",
          durationSeconds:
            details.media.durationSeconds == null
              ? null
              : Number(details.media.durationSeconds),
          status: details.media.status,
          folderName: details.folder?.name ?? null,
          createdAt: toIso(details.media.createdAt),
          shareUrl: details.shareUrl,
          noteBody: details.note?.body ?? null,
        },
        transcript: include.has("transcript") ? truncatedTranscript : undefined,
        transcriptTruncated:
          include.has("transcript") && transcriptText != null
            ? transcriptText.length > TRANSCRIPT_LIMIT
            : false,
        actionItems: include.has("actionItems")
          ? actionItems(details.aiOutput?.actionItems)
          : undefined,
        chapters: include.has("chapters")
          ? chapters(details.aiOutput?.chapters)
          : undefined,
        comments: include.has("comments")
          ? details.comments.map((comment) => ({
              id: comment.id,
              name: comment.commenterName,
              timestampSec: Number(comment.timestampSec),
              body: comment.body,
              createdAt: toIso(comment.createdAt),
            }))
          : undefined,
        attendees: include.has("attendees")
          ? details.attendees.map((attendee) => attendee.name)
          : undefined,
      });
    }
  );
}
