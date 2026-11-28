import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { generateSlug } from "@/lib/slug";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  presignUploadPart,
} from "@/lib/r2/multipart";
import { moveRecordingToFolder } from "@/db/queries/folders";
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
import { sanitizeFps } from "@/lib/review/frames";
import { baseTitle } from "@/lib/review/versions";
import { addToStack } from "@/db/queries/versions";

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
        "Step 1 of uploading a finished video file (mp4/mov/webm) as a Loomola recording. Creates the recording (optionally titled and branded) and returns presigned R2 PUT URLs, one per part of `partSize` bytes. PUT each byte range to its URL, keep each response's ETag header, then call loomola_upload_complete. Pass `versionOf` (id, slug or share URL of any version) to add the upload as the next version of that recording's stack: it inherits the brand, folder and password, and without a `title` it is titled '<base title> vN'. Shell agents: `loomola upload <file> --brand <name> [--version-of <slug>]` does all three steps.",
      inputSchema: z.object({
        filename: z.string().min(1),
        sizeBytes: z.number().int().positive().max(MAX_BYTES),
        title: z.string().max(300).optional(),
        brand: z.string().min(1).optional(),
        versionOf: z.string().min(3).optional(),
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

      // The stack this upload joins, resolved before anything is created.
      const base = input.versionOf ? await findOwnedMedia(ownerId, input.versionOf) : null;
      if (input.versionOf && (!base || base.type !== "video")) {
        return errorContent("not_found", `No video matches versionOf "${input.versionOf}".`);
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
          brandProfileId: brand?.id ?? base?.brandProfileId ?? null,
          uploadMetadata: { composite: { uploadId, key } },
        })
        .returning({ id: mediaObjects.id });

      let version: { number: number; groupId: string } | null = null;
      if (base) {
        const added = await addToStack({ ownerId, baseId: base.id, newId: row.id });
        if (!added.ok) {
          // Nothing has been uploaded yet: drop the row and the multipart.
          await abortMultipartUpload(key, uploadId);
          await db.delete(mediaObjects).where(eq(mediaObjects.id, row.id));
          return errorContent("version_failed", `Could not add to the stack: ${added.error}.`);
        }
        // Same folder as the stack, through the helper that also writes
        // media_folder_assignments.
        if (base.folderId) {
          await moveRecordingToFolder({ recordingId: row.id, ownerId, folderId: base.folderId });
        }
        version = { number: added.number, groupId: added.groupId };
        if (!input.title?.trim()) {
          const stem = baseTitle(base.title) || fallbackTitle || "Untitled";
          await db
            .update(mediaObjects)
            .set({ title: `${stem} v${added.number}` })
            .where(eq(mediaObjects.id, row.id));
        }
      }

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
        version,
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
        fps: z
          .number()
          .positive()
          .optional()
          .describe("Frame rate if known (ffprobe avg_frame_rate); enables frame-accurate comment timecodes."),
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
          ...(sanitizeFps(input.fps) != null ? { fps: String(sanitizeFps(input.fps)) } : {}),
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
