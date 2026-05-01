import { NextResponse } from "next/server";
import { getAudioNotePageData } from "@/db/queries/notes";
import {
  getAiOutputByMedia,
  resetAiOutputForEnhancement,
} from "@/db/queries/ai-outputs";
import { enqueueAiJobs } from "@/lib/queue/enqueue-processing";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

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
  return NextResponse.json({
    titleSuggested: aiOutput?.titleSuggested ?? null,
    summary: aiOutput?.summary ?? null,
    chapters: aiOutput?.chapters ?? null,
    actionItems: aiOutput?.actionItems ?? null,
    generationStatus: aiOutput?.generationStatusValue ?? "idle",
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
  if (!data.transcript) {
    return NextResponse.json(
      { error: "transcript_not_ready" },
      { status: 409 }
    );
  }

  const llmModel =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  const aiOutput = await resetAiOutputForEnhancement(data.media.id, llmModel);

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
      generationStatus: aiOutput.generationStatusValue,
    },
    { status: 202 }
  );
}
