import { NextResponse } from "next/server";
import { verifyAndConsumeCallbackToken } from "@/lib/deepgram/callback-signature";
import type { WordTimestamp } from "@/db/queries/transcripts";
import { persistTranscriptAndFanOut } from "@/lib/transcription/persist";
import {
  buildSegmentsFromWords,
  mergeSourceTranscriptSegments,
  sourceForDeepgramChannel,
  speakerForTranscriptSource,
  type SourceTranscriptWord,
} from "@/lib/transcript/source-merge";

type DeepgramWord = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  punctuated_word?: string;
  speaker?: number;
};

type DeepgramAlternative = {
  transcript?: string;
  confidence?: number;
  words?: DeepgramWord[];
};

type DeepgramChannel = {
  alternatives?: DeepgramAlternative[];
  detected_language?: string;
};

type DeepgramCallbackBody = {
  metadata?: {
    request_id?: string;
    created?: string;
  };
  results?: {
    channels?: DeepgramChannel[];
  };
};

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ recordingId: string; nonce: string; sig: string }>;
  }
) {
  const { recordingId, nonce, sig } = await params;

  const ok = await verifyAndConsumeCallbackToken({
    recordingId,
    nonce,
    sig,
  });
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = (await request.json()) as DeepgramCallbackBody;
  const channels = body.results?.channels ?? [];
  const parsedTranscript = parseDeepgramTranscript(channels);
  const requestId = body.metadata?.request_id ?? null;

  const result = await persistTranscriptAndFanOut({
    mediaObjectId: recordingId,
    provider: "deepgram",
    providerRequestId: requestId,
    transcript: parsedTranscript,
  });

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  console.log(
    result.kind === "audio_ready"
      ? `[webhook/deepgram] audio transcript saved for ${recordingId} (${result.wordCount} words)`
      : `[webhook/deepgram] transcript saved, processing jobs enqueued for ${recordingId} (${result.wordCount} words)`
  );
  return NextResponse.json({ ok: true });
}

function parseDeepgramTranscript(channels: DeepgramChannel[]): {
  fullText: string;
  language: string;
  wordTimestamps: WordTimestamp[];
} {
  if (channels.length > 1) {
    const segments = channels.flatMap((channel, index) => {
      const source = sourceForDeepgramChannel(index);
      const alt = channel.alternatives?.[0];
      const words = (alt?.words ?? []).flatMap((word): SourceTranscriptWord[] => {
        const text = word.punctuated_word ?? word.word;
        if (!text?.trim()) return [];
        return [
          {
            word: text,
            start: word.start,
            end: word.end,
            confidence: word.confidence,
            speaker: speakerForTranscriptSource(source),
          },
        ];
      });
      return buildSegmentsFromWords({
        source,
        transcript: alt?.transcript,
        words,
      });
    });
    const merged = mergeSourceTranscriptSegments(segments);
    return {
      fullText: merged.fullText,
      language: channels.find((channel) => channel.detected_language)?.detected_language ?? "en",
      wordTimestamps: merged.words,
    };
  }

  const channel = channels[0];
  const alt = channel?.alternatives?.[0];
  const words = alt?.words ?? [];
  return {
    fullText: alt?.transcript ?? "",
    language: channel?.detected_language ?? "en",
    wordTimestamps: words.map((word) => ({
      word: word.punctuated_word ?? word.word,
      start: word.start,
      end: word.end,
      confidence: word.confidence,
      speaker: word.speaker,
    })),
  };
}
