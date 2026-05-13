import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects, transcripts } from "@/db/schema";
import { getAudioNotePageData } from "@/db/queries/notes";
import { enqueueTranscription } from "@/lib/queue/boss";
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
  const data = await getAudioNotePageData(id, user.id);
  if (!data) return granolaNotFound();

  if (data.transcript && data.transcript.fullText.trim().length > 0) {
    return NextResponse.json(
      { error: "transcript_already_ready" },
      { status: 409 }
    );
  }

  const audioKey =
    data.media.r2MixedKey ?? data.media.r2MicKey ?? data.media.r2SystemaudioKey;
  if (!audioKey) {
    return NextResponse.json(
      { error: "audio_source_missing" },
      { status: 409 }
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(transcripts)
      .where(eq(transcripts.mediaObjectId, data.media.id));
    await tx
      .update(mediaObjects)
      .set({ status: "transcribing" })
      .where(
        and(
          eq(mediaObjects.id, data.media.id),
          eq(mediaObjects.ownerId, user.id),
          eq(mediaObjects.type, "audio")
        )
      );
  });

  await enqueueTranscription({
    mediaObjectId: data.media.id,
    audioKey,
  });

  return NextResponse.json(
    {
      ok: true,
      mediaStatus: "transcribing",
    },
    { status: 202 }
  );
}
