import { NextResponse } from "next/server";
import { listDictionaryTerms } from "@/db/queries/dictionary-terms";
import { getAudioNotePageData, upsertNoteTemplate } from "@/db/queries/notes";
import {
  updateTranscriptText,
  type WordTimestamp,
} from "@/db/queries/transcripts";
import { resetAiOutputForEnhancement } from "@/db/queries/ai-outputs";
import {
  buildVariantReplacementMap,
  collapseDictionaryVariants,
} from "@/lib/dictionary/transcript-rewrite";
import { DEFAULT_NOTE_TEMPLATE_ID } from "@/lib/ai/note-templates";
import { enableGranola } from "@/lib/feature-flags";
import { enqueueTranscriptEmbedding } from "@/lib/queue/boss";
import { enqueueAiJobs } from "@/lib/queue/enqueue-processing";
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
  if (!data.transcript) {
    return NextResponse.json(
      { error: "transcript_not_ready" },
      { status: 409 }
    );
  }

  const replacements = buildVariantReplacementMap(
    await listDictionaryTerms(data.media.ownerId)
  );
  const words = normalizeWordTimestamps(data.transcript.wordTimestamps);
  const rewritten = collapseDictionaryVariants(
    data.transcript.fullText,
    words,
    replacements
  );
  const changed =
    rewritten.fullText !== data.transcript.fullText ||
    JSON.stringify(rewritten.words) !== JSON.stringify(words);

  if (!changed) {
    return NextResponse.json({ ok: true, changed: false });
  }

  await updateTranscriptText({
    id: data.transcript.id,
    fullText: rewritten.fullText,
    wordTimestamps: rewritten.words,
  });

  const templateId =
    data.aiOutput?.templateId ?? data.note?.templateId ?? DEFAULT_NOTE_TEMPLATE_ID;
  if (templateId !== data.note?.templateId) {
    await upsertNoteTemplate(data.media.id, user.id, templateId);
  }

  const llmModel =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  await resetAiOutputForEnhancement(data.media.id, llmModel, templateId);

  try {
    await Promise.all([
      enqueueTranscriptEmbedding({ mediaObjectId: data.media.id }),
      enqueueAiJobs({ mediaObjectId: data.media.id }),
    ]);
  } catch (err) {
    console.error(
      `[notes/dictionary/reapply] failed to enqueue jobs for ${data.media.id}:`,
      err
    );
    return NextResponse.json({ error: "enqueue_failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      changed: true,
      generationStatus: "pending",
    },
    { status: 202 }
  );
}

function normalizeWordTimestamps(value: unknown): WordTimestamp[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const word = "word" in item ? item.word : null;
    const start = "start" in item ? item.start : null;
    const end = "end" in item ? item.end : null;
    const confidence = "confidence" in item ? item.confidence : null;
    const speaker = "speaker" in item ? item.speaker : null;
    if (typeof word !== "string") return [];
    if (typeof start !== "number" || typeof end !== "number") return [];
    return [
      {
        word,
        start,
        end,
        ...(typeof confidence === "number" ? { confidence } : {}),
        ...(typeof speaker === "number" ? { speaker } : {}),
      },
    ];
  });
}
