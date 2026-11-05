import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects, transcripts } from "@/db/schema";
import { getAudioNoteEnhancementStatus } from "@/db/queries/notes";
import { enqueueNoteAudioJobs, planNoteAudioJobs } from "@/lib/notes/audio-pipeline";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { noteTranscriptState } from "@/lib/notes/transcript-state";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;
  const data = await getAudioNoteEnhancementStatus(id, user.id);
  if (!data) return granolaNotFound();

  // The live transcript survives an empty batch callback, so "has text"
  // alone would lock a note whose batch pass heard nothing out of retry.
  // Same reading as the enhance status route, so the desktop's Retry
  // button and this gate agree.
  if (noteTranscriptState(data).transcriptState === "ready") {
    return NextResponse.json(
      { error: "transcript_already_ready" },
      { status: 409 }
    );
  }

  const source = {
    r2MicKey: data.r2MicKey,
    r2SystemaudioKey: data.r2SystemaudioKey,
    r2MixedKey: data.r2MixedKey,
    audioSegments: data.audioSegments,
  };
  if (planNoteAudioJobs(source).kind === "none") {
    return NextResponse.json(
      { error: "audio_source_missing" },
      { status: 409 }
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(transcripts)
      .where(eq(transcripts.mediaObjectId, data.mediaId));
    await tx
      .update(mediaObjects)
      .set({ status: "transcribing" })
      .where(
        and(
          eq(mediaObjects.id, data.mediaId),
          eq(mediaObjects.ownerId, user.id),
          eq(mediaObjects.type, "audio")
        )
      );
  });

  await enqueueNoteAudioJobs(data.mediaId, source);

  return NextResponse.json(
    {
      ok: true,
      mediaStatus: "transcribing",
    },
    { status: 202 }
  );
}
