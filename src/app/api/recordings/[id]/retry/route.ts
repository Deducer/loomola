import { requireAuth } from "@/lib/require-auth";
import { apiError, withApiErrorHandling } from "@/lib/api/error";
import { getRecordingOwned } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { getAiOutputByMedia, insertBlankAiOutput } from "@/db/queries/ai-outputs";
import { decideRetryStage } from "@/lib/recordings/retry-plan";
import { enqueueTranscription, enqueueThumbnail } from "@/lib/queue/boss";
import { enqueueAiJobs } from "@/lib/queue/enqueue-processing";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * Owner-only: re-runs the pipeline for a failed recording from the
 * appropriate stage. Clears failure_reason and moves status back to the
 * matching in-progress value; the normal pipeline (webhook /
 * flipToReadyIfComplete / watchdog) takes it from there.
 */
export const POST = withApiErrorHandling(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const user = await requireAuth(request);
  const { id } = await params;

  const rec = await getRecordingOwned(id, user.id);
  if (!rec) return apiError(404, "not_found", "Recording not found.");
  if (rec.status !== "failed") {
    return apiError(
      409,
      "not_failed",
      "Only failed recordings can be retried. If it looks stuck, the watchdog will mark it failed within minutes of its threshold."
    );
  }

  const transcript = await getTranscriptByRecording(rec.id);
  const decision = decideRetryStage({
    type: rec.type,
    hasTranscript: Boolean(transcript?.fullText.trim()),
    r2MixedKey: rec.r2MixedKey,
    r2CompositeKey: rec.r2CompositeKey,
    r2MicKey: rec.r2MicKey,
    r2SystemaudioKey: rec.r2SystemaudioKey,
  });

  if (decision.kind === "unrecoverable") {
    return apiError(409, "unrecoverable", decision.message);
  }

  const setStatus = (status: "transcribing" | "processing" | "ready") =>
    db
      .update(mediaObjects)
      .set({ status, failureReason: null, updatedAt: sql`now()` })
      .where(
        and(eq(mediaObjects.id, rec.id), eq(mediaObjects.ownerId, user.id))
      );

  if (decision.kind === "transcribe") {
    await setStatus("transcribing");
    await enqueueTranscription(
      decision.isAudioSource
        ? { mediaObjectId: rec.id, audioKey: decision.sourceKey }
        : { mediaObjectId: rec.id, compositeKey: decision.sourceKey }
    );
    return Response.json({ ok: true, stage: "transcribe" });
  }

  if (decision.kind === "audio-ready") {
    // Transcript exists; audio notes are 'ready' at that point (webhook
    // parity). Re-enhancement stays on the existing Enhance button.
    await setStatus("ready");
    return Response.json({ ok: true, stage: "ready" });
  }

  // decision.kind === "ai" — transcript exists, re-run the transcript-
  // dependent jobs. flipToReadyIfComplete also requires a thumbnail, so
  // re-enqueue that too when it's missing (otherwise retry can never
  // reach 'ready').
  const llmModel =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  if (!(await getAiOutputByMedia(rec.id))) {
    await insertBlankAiOutput(rec.id, llmModel);
  }
  await setStatus("processing");
  await enqueueAiJobs({ mediaObjectId: rec.id });
  if (!rec.compositeThumbnailKey && rec.r2CompositeKey) {
    await enqueueThumbnail({
      mediaObjectId: rec.id,
      compositeKey: rec.r2CompositeKey,
    });
  }
  return Response.json({ ok: true, stage: "ai" });
});
