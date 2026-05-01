import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingOwned } from "@/db/queries/recordings";
import { completeMultipartUpload } from "@/lib/r2/multipart";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { TrackKind } from "@/lib/recording/types";
import {
  enqueuePlaybackTranscode,
  enqueuePreviewSprite,
  enqueueThumbnail,
  enqueueTranscription,
  enqueueMixAudio,
  enqueueAudioWaveform,
} from "@/lib/queue/boss";
import { enableGranola } from "@/lib/feature-flags";

type CompleteRequest = {
  tracks: Partial<
    Record<TrackKind, Array<{ PartNumber: number; ETag: string }>>
  >;
  durationSeconds: number;
};

type UploadMeta = {
  [K in TrackKind]?: { uploadId: string; key: string };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const body = (await request.json()) as CompleteRequest;

  const recording = await getRecordingOwned(id, user.id);
  if (!recording) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (recording.type === "audio" && !enableGranola()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = recording.uploadMetadata as UploadMeta | null;
  if (!meta) {
    return NextResponse.json({ error: "No active uploads" }, { status: 400 });
  }

  const keyUpdates: {
    r2CompositeKey?: string;
    r2ScreenKey?: string;
    r2CameraKey?: string;
    r2MicKey?: string;
    r2SystemaudioKey?: string;
    r2MixedKey?: string;
  } = {};

  // Track which kinds we've enqueued so the error message can name the failing one.
  const completionPlans: Array<{
    kind: TrackKind;
    key: string;
    uploadId: string;
    partCount: number;
    promise: Promise<void>;
  }> = [];

  for (const [kind, parts] of Object.entries(body.tracks) as Array<
    [TrackKind, Array<{ PartNumber: number; ETag: string }>]
  >) {
    const trackMeta = meta[kind];
    if (!trackMeta) continue;
    if (!parts || parts.length === 0) continue;
    completionPlans.push({
      kind,
      key: trackMeta.key,
      uploadId: trackMeta.uploadId,
      partCount: parts.length,
      promise: completeMultipartUpload(trackMeta.key, trackMeta.uploadId, parts),
    });
    switch (kind) {
      case "composite":
        keyUpdates.r2CompositeKey = trackMeta.key;
        break;
      case "screen":
        keyUpdates.r2ScreenKey = trackMeta.key;
        break;
      case "camera":
        keyUpdates.r2CameraKey = trackMeta.key;
        break;
      case "mic":
        keyUpdates.r2MicKey = trackMeta.key;
        break;
      case "system-audio":
        keyUpdates.r2SystemaudioKey = trackMeta.key;
        break;
    }
  }

  // Run all multipart completions in parallel. Use allSettled so we can name
  // every failing track in the response — debugging "complete failed: 500"
  // by digging through Coolify logs is awful otherwise.
  const results = await Promise.allSettled(completionPlans.map((p) => p.promise));
  const failed = results
    .map((r, i) => (r.status === "rejected" ? { plan: completionPlans[i], reason: r.reason } : null))
    .filter((x): x is { plan: typeof completionPlans[number]; reason: unknown } => x !== null);

  if (failed.length > 0) {
    for (const f of failed) {
      console.error(
        `[complete] R2 multipart completion failed: kind=${f.plan.kind} key=${f.plan.key} parts=${f.plan.partCount}`,
        f.reason
      );
    }
    return NextResponse.json(
      {
        error: "multipart_complete_failed",
        details: failed.map((f) => ({
          kind: f.plan.kind,
          partCount: f.plan.partCount,
          message: f.reason instanceof Error ? f.reason.message : String(f.reason),
        })),
      },
      { status: 500 }
    );
  }

  try {
    const audioKey =
      recording.type === "audio"
        ? keyUpdates.r2MicKey ?? keyUpdates.r2SystemaudioKey
        : undefined;
    if (recording.type === "audio" && !audioKey) {
      return NextResponse.json(
        { error: "audio_track_required" },
        { status: 400 }
      );
    }
    if (
      recording.type === "audio" &&
      !(keyUpdates.r2MicKey && keyUpdates.r2SystemaudioKey)
    ) {
      keyUpdates.r2MixedKey = audioKey;
    }

    // Flip to 'transcribing' (was 'ready' pre-M5). Webhook moves to 'ready'.
    await db
      .update(mediaObjects)
      .set({
        ...keyUpdates,
        durationSeconds: String(body.durationSeconds),
        status: "transcribing",
        uploadMetadata: null,
      })
      .where(
        and(eq(mediaObjects.id, recording.id), eq(mediaObjects.ownerId, user.id))
      );
  } catch (err) {
    console.error(`[complete] db update failed for recording=${recording.id}`, err);
    return NextResponse.json(
      {
        error: "db_update_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  // Post-upload video jobs need the finished composite object. Thumbnail and
  // preview-sprite don't depend on the transcript, so kick them off here
  // in parallel with Deepgram instead of fanning out from the webhook —
  // saves the Deepgram round-trip on the dashboard thumbnail's critical
  // path. The transcript-dependent AI jobs still fire from the webhook.
  if (recording.type === "video" && keyUpdates.r2CompositeKey) {
    try {
      await Promise.all([
        enqueueTranscription({
          mediaObjectId: recording.id,
          audioKey: keyUpdates.r2CompositeKey,
        }),
        enqueuePlaybackTranscode({
          mediaObjectId: recording.id,
          compositeKey: keyUpdates.r2CompositeKey,
        }),
        enqueueThumbnail({
          mediaObjectId: recording.id,
          compositeKey: keyUpdates.r2CompositeKey,
        }),
        enqueuePreviewSprite({
          mediaObjectId: recording.id,
          compositeKey: keyUpdates.r2CompositeKey,
        }),
      ]);
    } catch (err) {
      console.error("[complete] failed to enqueue post-upload jobs:", err);
      // Fall through — user still gets a slug; stuck row is visible via status.
    }
  }

  if (recording.type === "audio") {
    try {
      if (keyUpdates.r2MicKey && keyUpdates.r2SystemaudioKey) {
        await enqueueMixAudio({
          mediaObjectId: recording.id,
          micKey: keyUpdates.r2MicKey,
          systemAudioKey: keyUpdates.r2SystemaudioKey,
        });
      } else {
        const audioKey = keyUpdates.r2MicKey ?? keyUpdates.r2SystemaudioKey;
        if (audioKey) {
          await Promise.all([
            enqueueTranscription({ mediaObjectId: recording.id, audioKey }),
            enqueueAudioWaveform({ mediaObjectId: recording.id, audioKey }),
          ]);
        }
      }
    } catch (err) {
      console.error("[complete] failed to enqueue audio jobs:", err);
    }
  }

  return NextResponse.json({ slug: recording.slug });
}
