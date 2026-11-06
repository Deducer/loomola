import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiOutputs, brandProfiles, comments, transcripts } from "@/db/schema";
import { softDeleteRecording } from "@/db/queries/recordings";
import { mediaShareUrl } from "@/lib/recordings/queries";
import { trashRetentionDays } from "@/lib/queue/jobs/purge-deleted";
import { getMcpOwnerId } from "./owner";
import { findOwnedMedia } from "./lookup";
import { errorContent, jsonContent } from "./shared";

export function registerStatusTools(server: McpServer): void {
  server.registerTool(
    "loomola_recording_status",
    {
      title: "Recording processing status",
      description:
        "Processing status of one recording: overall status, which pipeline steps are done (playback transcode, thumbnail, scrub previews, transcript, AI title/summary), its brand, comment count and share URL. `recording` takes an id, slug or share URL. For the transcript text itself use loomola_get_media.",
      inputSchema: z.object({ recording: z.string().min(3) }),
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const media = await findOwnedMedia(ownerId, input.recording);
      if (!media) return errorContent("not_found", `No recording matches "${input.recording}".`);

      const [[transcript], [ai], [brand], [commentCount]] = await Promise.all([
        db
          .select({ id: transcripts.id })
          .from(transcripts)
          .where(eq(transcripts.mediaObjectId, media.id))
          .limit(1),
        db
          .select({ title: aiOutputs.titleSuggested, summary: aiOutputs.summary })
          .from(aiOutputs)
          .where(eq(aiOutputs.mediaObjectId, media.id))
          .limit(1),
        media.brandProfileId
          ? db
              .select({ id: brandProfiles.id, name: brandProfiles.name })
              .from(brandProfiles)
              .where(eq(brandProfiles.id, media.brandProfileId))
              .limit(1)
          : Promise.resolve([]),
        db.select({ n: count() }).from(comments).where(eq(comments.mediaObjectId, media.id)),
      ]);

      const steps = {
        uploaded: media.status !== "uploading",
        playbackTranscode: media.type === "video" ? Boolean(media.playbackMp4Key) : null,
        thumbnail: media.type === "video" ? Boolean(media.compositeThumbnailKey) : null,
        previewSprite: media.type === "video" ? Boolean(media.previewSpriteKey) : null,
        transcript: Boolean(transcript),
        aiTitleAndSummary: Boolean(ai?.title || ai?.summary),
      };

      return jsonContent({
        recordingId: media.id,
        slug: media.slug,
        type: media.type,
        status: media.status,
        failureReason: media.failureReason,
        ready: media.status === "ready",
        steps,
        title: media.title ?? ai?.title ?? null,
        aiTitle: ai?.title ?? null,
        durationSeconds: media.durationSeconds == null ? null : Number(media.durationSeconds),
        brand: brand ?? null,
        passwordProtected: Boolean(media.passwordHash),
        commentCount: commentCount?.n ?? 0,
        shareUrl: mediaShareUrl(media),
      });
    }
  );

  server.registerTool(
    "loomola_trash_recording",
    {
      title: "Move a recording to the trash",
      description: `Move one recording to the trash. Its share link stops working at once; it stays restorable from the dashboard trash for ${trashRetentionDays()} days, then it and its files are purged. Confirm with the user before trashing anything they did not ask to remove.`,
      inputSchema: z.object({ recording: z.string().min(3) }),
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const media = await findOwnedMedia(ownerId, input.recording);
      if (!media) return errorContent("not_found", `No recording matches "${input.recording}".`);
      await softDeleteRecording(media.id, ownerId);
      return jsonContent({ ok: true, trashed: media.id, slug: media.slug });
    }
  );
}
