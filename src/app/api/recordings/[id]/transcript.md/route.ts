import { NextResponse } from "next/server";
import { getRecordingForEdit } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { requireAuth } from "@/lib/require-auth";
import {
  buildRecordingTranscriptMarkdown,
  recordingTranscriptFilename,
  transcriptDownloadHeaders,
} from "@/lib/recordings/transcript-export";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const recording = await getRecordingForEdit(id, user.id);
  if (!recording || recording.type !== "video") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const transcript = await getTranscriptByRecording(recording.id);
  if (!transcript || transcript.fullText.trim().length === 0) {
    return NextResponse.json({ error: "transcript_not_ready" }, { status: 404 });
  }

  const payload = {
    title: recording.title ?? recording.aiTitle ?? "Untitled recording",
    slug: recording.slug,
    createdAt: recording.createdAt,
    durationSeconds: recording.durationSeconds,
    shareUrl: `${appBaseUrl(request.url)}/v/${recording.slug}`,
    fullText: transcript.fullText,
    wordTimestamps: transcript.wordTimestamps,
  };

  return new Response(buildRecordingTranscriptMarkdown(payload), {
    headers: transcriptDownloadHeaders(
      recordingTranscriptFilename(payload, "md"),
      "text/markdown; charset=utf-8"
    ),
  });
}

function appBaseUrl(requestUrl: string): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? new URL(requestUrl).origin).replace(
    /\/$/,
    ""
  );
}
