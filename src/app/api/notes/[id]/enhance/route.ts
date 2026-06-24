import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getAudioNoteEnhancementStatus,
  type AudioNoteEnhancementStatus,
} from "@/db/queries/notes";
import {
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

function noteTranscriptState(data: AudioNoteEnhancementStatus) {
  const transcriptTextLength = data.transcriptTextLength ?? 0;
  const transcriptState = data.transcriptTextLength == null
    ? "missing"
    : transcriptTextLength > 0
      ? "ready"
      : "empty";
  const audioSourceKey =
    data.r2MixedKey ?? data.r2MicKey ?? data.r2SystemaudioKey;
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
  const data = await getAudioNoteEnhancementStatus(id, user.id);
  if (!data) return granolaNotFound();

  const { transcriptTextLength, transcriptState, canRetryTranscript } =
    noteTranscriptState(data);
  return NextResponse.json({
    titleSuggested: data.titleSuggested ?? null,
    summary: data.summary ?? null,
    chapters: data.chapters ?? null,
    actionItems: data.actionItems ?? null,
    templateId: data.aiTemplateId ?? data.noteTemplateId ?? DEFAULT_NOTE_TEMPLATE_ID,
    generationStatus: data.generationStatus ?? "idle",
    mediaStatus: data.mediaStatus,
    transcriptReady: data.transcriptTextLength != null && transcriptTextLength > 0,
    transcriptTextLength,
    transcriptState,
    failureReason: data.failureReason ?? null,
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
  const data = await getAudioNoteEnhancementStatus(id, user.id);
  if (!data) return granolaNotFound();
  const { transcriptTextLength, canRetryTranscript } = noteTranscriptState(data);
  if (data.transcriptTextLength == null) {
    if (data.mediaStatus === "failed") {
      return NextResponse.json(
        {
          error: "transcript_failed",
          message: data.failureReason ?? "Transcription failed.",
          failureReason: data.failureReason ?? null,
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
    parsed.data.templateId ?? data.noteTemplateId ?? DEFAULT_NOTE_TEMPLATE_ID;
  if (!isSystemNoteTemplateId(templateId)) {
    return NextResponse.json({ error: "unknown_template" }, { status: 400 });
  }
  if (templateId !== data.noteTemplateId) {
    await upsertNoteTemplate(data.mediaId, user.id, templateId);
  }

  const llmModel =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  const aiOutput = await resetAiOutputForEnhancement(
    data.mediaId,
    llmModel,
    templateId
  );

  try {
    await enqueueAiJobs({ mediaObjectId: data.mediaId });
  } catch (err) {
    console.error(
      `[notes/enhance] failed to enqueue enhancement for ${data.mediaId}:`,
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
