import { NextResponse } from "next/server";
import { z } from "zod";
import { getAudioNotePageData } from "@/db/queries/notes";
import {
  getAiOutputByMedia,
  resetAiOutputForEnhancement,
} from "@/db/queries/ai-outputs";
import { upsertNoteTemplate } from "@/db/queries/notes";
import { enqueueAiJobs } from "@/lib/queue/enqueue-processing";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  isSystemNoteTemplateId,
} from "@/lib/ai/note-templates";

const enhanceRequestSchema = z.object({
  templateId: z.string().optional(),
});

function noteTranscriptState(data: NonNullable<Awaited<ReturnType<typeof getAudioNotePageData>>>) {
  const transcriptTextLength = data.transcript?.fullText.trim().length ?? 0;
  const transcriptState = !data.transcript
    ? "missing"
    : transcriptTextLength > 0
      ? "ready"
      : "empty";
  const audioSourceKey =
    data.media.r2MixedKey ?? data.media.r2MicKey ?? data.media.r2SystemaudioKey;
  const canRetryTranscript =
    transcriptState !== "ready" && Boolean(audioSourceKey);

  return {
    transcriptTextLength,
    transcriptState,
    audioSourceKey,
    canRetryTranscript,
  };
}

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;
  const data = await getAudioNotePageData(id, user.id);
  if (!data) return granolaNotFound();

  const aiOutput = await getAiOutputByMedia(data.media.id);
  const { transcriptTextLength, transcriptState, canRetryTranscript } =
    noteTranscriptState(data);
  return NextResponse.json({
    titleSuggested: aiOutput?.titleSuggested ?? null,
    summary: aiOutput?.summary ?? null,
    chapters: aiOutput?.chapters ?? null,
    actionItems: aiOutput?.actionItems ?? null,
    templateId: aiOutput?.templateId ?? data.note?.templateId ?? DEFAULT_NOTE_TEMPLATE_ID,
    generationStatus: aiOutput?.generationStatusValue ?? "idle",
    mediaStatus: data.media.status,
    transcriptReady: Boolean(data.transcript && transcriptTextLength > 0),
    transcriptTextLength,
    transcriptState,
    failureReason: data.media.failureReason ?? null,
    canRetryTranscript,
  });
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
  const { transcriptTextLength, canRetryTranscript } = noteTranscriptState(data);
  if (!data.transcript) {
    if (data.media.status === "failed") {
      return NextResponse.json(
        {
          error: "transcript_failed",
          message: data.media.failureReason ?? "Transcription failed.",
          failureReason: data.media.failureReason ?? null,
          canRetryTranscript,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "transcript_not_ready", canRetryTranscript },
      { status: 409 }
    );
  }
  if (transcriptTextLength === 0) {
    return NextResponse.json(
      { error: "transcript_empty", canRetryTranscript },
      { status: 409 }
    );
  }

  const json = await request.json().catch(() => ({}));
  const parsed = enhanceRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const templateId =
    parsed.data.templateId ?? data.note?.templateId ?? DEFAULT_NOTE_TEMPLATE_ID;
  if (!isSystemNoteTemplateId(templateId)) {
    return NextResponse.json({ error: "unknown_template" }, { status: 400 });
  }
  if (templateId !== data.note?.templateId) {
    await upsertNoteTemplate(data.media.id, user.id, templateId);
  }

  const llmModel =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  const aiOutput = await resetAiOutputForEnhancement(
    data.media.id,
    llmModel,
    templateId
  );

  try {
    await enqueueAiJobs({ mediaObjectId: data.media.id });
  } catch (err) {
    console.error(
      `[notes/enhance] failed to enqueue enhancement for ${data.media.id}:`,
      err
    );
    return NextResponse.json({ error: "enqueue_failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      titleSuggested: aiOutput.titleSuggested,
      summary: aiOutput.summary,
      templateId: aiOutput.templateId,
      generationStatus: aiOutput.generationStatusValue,
    },
    { status: 202 }
  );
}
