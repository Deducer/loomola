import { NextResponse } from "next/server";
import { getAudioNotePageData } from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { groupWordsIntoParagraphs, type Word } from "@/lib/viewer/paragraphs";

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
  if (!data.transcript) {
    return NextResponse.json(
      { error: "transcript_not_ready" },
      { status: 404 }
    );
  }

  const fullText = data.transcript.fullText;
  const paragraphs = groupWordsIntoParagraphs(
    normalizeWords(data.transcript.wordTimestamps)
  );

  return NextResponse.json(
    {
      fullText,
      language: data.transcript.language,
      provider: data.transcript.provider,
      paragraphs:
        paragraphs.length > 0
          ? paragraphs.map((paragraph) => ({
              speaker:
                typeof paragraph.speaker === "number"
                  ? `Speaker ${paragraph.speaker + 1}`
                  : null,
              startSec: paragraph.startSec,
              endSec: paragraph.endSec,
              text: paragraph.text,
            }))
          : fullText.trim()
            ? [{ speaker: null, startSec: 0, endSec: 0, text: fullText.trim() }]
            : [],
    },
    { status: 200 }
  );
}

function normalizeWords(value: unknown): Word[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const word = "word" in item ? item.word : null;
    const start = "start" in item ? item.start : null;
    const end = "end" in item ? item.end : null;
    const speaker = "speaker" in item ? item.speaker : null;
    if (typeof word !== "string") return [];
    if (typeof start !== "number" || typeof end !== "number") return [];
    return [
      {
        word,
        start,
        end,
        ...(typeof speaker === "number" ? { speaker } : {}),
      },
    ];
  });
}
