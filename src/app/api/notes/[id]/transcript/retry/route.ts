import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects, transcripts } from "@/db/schema";
import { getAudioNoteEnhancementStatus } from "@/db/queries/notes";
import { enqueueMixAudio, enqueueTranscription } from "@/lib/queue/boss";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

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

  if ((data.transcriptTextLength ?? 0) > 0) {
    return NextResponse.json(
      { error: "transcript_already_ready" },
      { status: 409 }
    );
  }

  const hasSplitTracks = Boolean(data.r2MicKey && data.r2SystemaudioKey);
  const audioKey = data.r2MixedKey ?? data.r2MicKey ?? data.r2SystemaudioKey;
  if (!audioKey && !hasSplitTracks) {
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

  if (data.r2MicKey && data.r2SystemaudioKey) {
    await enqueueMixAudio({
      mediaObjectId: data.mediaId,
      micKey: data.r2MicKey,
      systemAudioKey: data.r2SystemaudioKey,
    });
  } else if (audioKey) {
    await enqueueTranscription({
      mediaObjectId: data.mediaId,
      audioKey,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      mediaStatus: "transcribing",
    },
    { status: 202 }
  );
}
