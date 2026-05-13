import { NextResponse } from "next/server";
import { z } from "zod";
import { getAudioNotePageData } from "@/db/queries/notes";
import {
  insertLiveTranscript,
  type WordTimestamp,
} from "@/db/queries/transcripts";
import { listDictionaryTerms } from "@/db/queries/dictionary-terms";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import {
  buildVariantReplacementMap,
  collapseDictionaryVariants,
} from "@/lib/dictionary/transcript-rewrite";

const liveWordSchema = z
  .object({
    word: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    confidence: z.number().min(0).max(1).optional(),
    speaker: z.number().int().nonnegative().optional(),
  })
  .refine((word) => word.end >= word.start, {
    message: "word end must be greater than or equal to start",
  });

const liveTranscriptSchema = z.object({
  fullText: z.string().max(1_000_000),
  language: z.string().min(2).max(32).optional(),
  providerRequestId: z.string().max(256).optional().nullable(),
  words: z.array(liveWordSchema).max(250_000).default([]),
});

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

  const json = await request.json().catch(() => null);
  const parsed = liveTranscriptSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const fullText = parsed.data.fullText.trim();
  if (fullText.length === 0 && parsed.data.words.length === 0) {
    return NextResponse.json({ ok: true, inserted: false });
  }

  const replacements = buildVariantReplacementMap(
    await listDictionaryTerms(data.media.ownerId)
  );
  const rewritten = collapseDictionaryVariants(
    fullText,
    parsed.data.words as WordTimestamp[],
    replacements
  );

  const { transcript, inserted } = await insertLiveTranscript({
    mediaObjectId: data.media.id,
    providerRequestId: parsed.data.providerRequestId ?? null,
    language: parsed.data.language ?? "en",
    fullText: rewritten.fullText,
    wordTimestamps: rewritten.words,
  });

  return NextResponse.json({
    ok: true,
    inserted,
    provider: transcript.provider,
    wordCount: rewritten.words.length,
  });
}
