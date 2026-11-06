import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { generateSlug } from "@/lib/slug";
import {
  completeMultipartUpload,
  createMultipartUpload,
  presignUploadPart,
} from "@/lib/r2/multipart";
import { keyForTrack } from "@/lib/recording/upload-keys";
import {
  enqueuePlaybackTranscode,
  enqueuePreviewSprite,
  enqueueThumbnail,
  enqueueTranscription,
} from "@/lib/queue/boss";
import { mediaShareUrl } from "@/lib/recordings/queries";
import { getMcpOwnerId } from "./owner";
import { brandPickError, findOwnedMedia, resolveBrand } from "./lookup";
import { errorContent, jsonContent } from "./shared";

const MIB = 1024 * 1024;
const MIN_PART = 8 * MIB; // R2 needs >= 5 MiB for every part but the last
const MAX_PARTS = 1000; // keeps the presigned-URL list a manageable size
const MAX_BYTES = 20 * 1024 * MIB;

export function mimeForFilename(filename: string): string | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "mp4" || ext === "m4v" || ext === "mov") return "video/mp4";
  if (ext === "webm") return "video/webm";
  return null;
}

/** Part size (whole MiB, at least 8) and count for a file of `sizeBytes`. */
export function planParts(sizeBytes: number): { partSize: number; partCount: number } {
  const needed = Math.ceil(sizeBytes / MAX_PARTS);
  const partSize = Math.max(MIN_PART, Math.ceil(needed / MIB) * MIB);
  return { partSize, partCount: Math.max(1, Math.ceil(sizeBytes / partSize)) };
}

function editUrl(id: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/recordings/${id}/edit`;
}

type UploadMeta = { composite?: { uploadId: string; key: string } };

export function registerUploadTools(server: McpServer): void {
  server.registerTool(
    "loomola_upload_begin",
    {
      title: "Begin a video upload",
      description:
        "Step 1 of uploading a finished video file (mp4/mov/webm) as a Loomola recording. Creates the recording (optionally titled and branded) and returns presigned R2 PUT URLs, one per part of `partSize` bytes. PUT each byte range to its URL, keep each response's ETag header, then call loomola_upload_complete. Shell agents: `node scripts/loomola.mjs upload <file> --brand <name>` in the Loomola repo does all three steps.",
      inputSchema: z.object({
        filename: z.string().min(1),
        sizeBytes: z.number().int().positive().max(MAX_BYTES),
        title: z.string().max(300).optional(),
        brand: z.string().min(1).optional(),
      }),
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const mimeType = mimeForFilename(input.filename);
      if (!mimeType) {
        return errorContent("unsupported_type", "Use an .mp4, .m4v, .mov or .webm file.");
      }

      let brand: { id: string; name: string } | null = null;
      if (input.brand) {
        const pick = await resolveBrand(ownerId, input.brand);
        if (!pick.ok) {
          const e = brandPickError(input.brand, pick);
          return errorContent(e.error, e.message, { brands: e.brands });
        }
        brand = pick.brand;
      }

      const slug = generateSlug();
      const key = keyForTrack(slug, "composite", mimeType);
      const uploadId = await createMultipartUpload(key, mimeType);
      const fallbackTitle = input.filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
      const [row] = await db
        .insert(mediaObjects)
        .values({
          ownerId,
          type: "video",
          slug,
          title: input.title?.trim() || fallbackTitle || null,
          status: "uploading",
          brandProfileId: brand?.id ?? null,
          uploadMetadata: { composite: { uploadId, key } },
        })
        .returning({ id: mediaObjects.id });

      const { partSize, partCount } = planParts(input.sizeBytes);
      const parts = await Promise.all(
        Array.from({ length: partCount }, async (_, i) => ({
          partNumber: i + 1,
          url: await presignUploadPart(key, uploadId, i + 1),
        }))
      );

      return jsonContent({
        recordingId: row.id,
        slug,
        brand,
        shareUrl: mediaShareUrl({ type: "video", slug }),
        partSize,
        partCount,
        urlsExpireInSec: 3600,
        parts,
      });
    }
  );

  server.registerTool(
    "loomola_upload_complete",
    {
      title: "Complete a video upload",
      description:
        "Step 2 of a video upload: finish the R2 multipart upload with each part's ETag and start processing (transcode, thumbnail, transcript, AI title/summary). Returns the share URL; poll loomola_recording_status to see processing finish.",
      inputSchema: z.object({
        recordingId: z.string().uuid(),
        durationSeconds: z.number().positive(),
        parts: z
          .array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1) }))
          .min(1),
      }),
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const media = await findOwnedMedia(ownerId, input.recordingId);
      if (!media || media.type !== "video") {
        return errorContent("not_found", `No video recording ${input.recordingId}.`);
      }
      const track = (media.uploadMetadata as UploadMeta | null)?.composite;
      if (!track) {
        return errorContent("no_active_upload", "This recording has no upload in progress.");
      }

      const parts = [...input.parts]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag }));
      try {
        await completeMultipartUpload(track.key, track.uploadId, parts);
      } catch (err) {
        return errorContent(
          "multipart_complete_failed",
          err instanceof Error ? err.message : String(err)
        );
      }

      // Same transition and job fan-out as POST /api/recordings/:id/complete.
      await db
        .update(mediaObjects)
        .set({
          r2CompositeKey: track.key,
          durationSeconds: String(input.durationSeconds),
          status: "transcribing",
          uploadMetadata: null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(mediaObjects.id, media.id), eq(mediaObjects.ownerId, ownerId)));

      let jobsQueued = true;
      try {
        await Promise.all([
          enqueueTranscription({ mediaObjectId: media.id, audioKey: track.key }),
          enqueuePlaybackTranscode({ mediaObjectId: media.id, compositeKey: track.key }),
          enqueueThumbnail({ mediaObjectId: media.id, compositeKey: track.key }),
          enqueuePreviewSprite({ mediaObjectId: media.id, compositeKey: track.key }),
        ]);
      } catch (err) {
        console.error("[mcp upload_complete] failed to enqueue post-upload jobs:", err);
        jobsQueued = false;
      }

      return jsonContent({
        ok: true,
        recordingId: media.id,
        slug: media.slug,
        shareUrl: mediaShareUrl(media),
        editUrl: editUrl(media.id),
        status: "transcribing",
        jobsQueued,
      });
    }
  );
}
