import { getDeepgramClient } from "@/lib/deepgram/client";
import { issueDeepgramCallbackToken } from "@/lib/deepgram/callback-signature";
import { isDeepgramPaymentRequiredError } from "@/lib/deepgram/errors";
import { resolveTranscribeProvider } from "./provider";
import { runWhisperTranscription } from "./openai-whisper";
import type { NormalizedTranscript } from "./types";

export type SubmitTranscriptionInput = {
  mediaObjectId: string;
  audioUrl: string;
  multichannel: boolean;
  language?: string;
  /** Canonical dictionary terms — Deepgram keywords / whisper prompt bias. */
  terms: string[];
};

export type SubmitTranscriptionOutcome =
  | { mode: "callback" }
  | {
      mode: "sync";
      result: NormalizedTranscript;
      providerRequestId: string | null;
    }
  | { mode: "failed"; failureReason: string };

const deepgramNoCreditsReason =
  "Transcription failed: the Deepgram account has no credits (402 Payment Required).";

/**
 * Provider dispatch — two providers, one switch (deliberately no
 * registry). deepgram returns mode:'callback' (the webhook persists);
 * openai-whisper returns mode:'sync' (the caller persists);
 * mode:'failed' means a terminal, user-explainable failure.
 */
export async function submitTranscription(
  input: SubmitTranscriptionInput
): Promise<SubmitTranscriptionOutcome> {
  const provider = resolveTranscribeProvider();

  if (provider === "openai-whisper") {
    if (input.multichannel) {
      // Whisper has no per-channel transcription; the granola stereo
      // transcript file (mic-L/system-R) is downmixed to mono by the
      // ffmpeg extract step. Speaker separation is lost — documented.
      console.log(
        `[transcribe] whisper: downmixing multichannel audio for ${input.mediaObjectId} (single speaker)`
      );
    }
    const run = await runWhisperTranscription({
      mediaObjectId: input.mediaObjectId,
      audioUrl: input.audioUrl,
      language: input.language,
      terms: input.terms,
    });
    if (!run.ok) return { mode: "failed", failureReason: run.failureReason };
    return {
      mode: "sync",
      result: run.result,
      providerRequestId: run.providerRequestId,
    };
  }

  // deepgram (default) — moved verbatim from runTranscribeJob. The
  // NEXT_PUBLIC_APP_URL requirement lives HERE, not in the job: only the
  // callback flow needs a publicly reachable URL.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  const { nonce, sig } = await issueDeepgramCallbackToken({
    recordingId: input.mediaObjectId,
  });
  const callbackUrl = `${appUrl}/api/webhooks/deepgram/${input.mediaObjectId}/${nonce}/${sig}`;

  const dg = getDeepgramClient();
  try {
    await dg.listen.v1.media.transcribeUrl({
      url: input.audioUrl,
      callback: callbackUrl,
      model: "nova-2",
      smart_format: true,
      diarize: input.multichannel ? false : true,
      ...(input.multichannel ? { multichannel: true } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.terms.length > 0 ? { keywords: input.terms } : {}),
    });
  } catch (err) {
    if (isDeepgramPaymentRequiredError(err)) {
      if (!process.env.OPENAI_API_KEY?.trim()) {
        return { mode: "failed", failureReason: deepgramNoCreditsReason };
      }

      console.warn(
        `[transcribe] Deepgram has no credits for ${input.mediaObjectId}; falling back to OpenAI Whisper`
      );
      if (input.multichannel) {
        console.log(
          `[transcribe] whisper fallback: downmixing multichannel audio for ${input.mediaObjectId} (single speaker)`
        );
      }
      const run = await runWhisperTranscription({
        mediaObjectId: input.mediaObjectId,
        audioUrl: input.audioUrl,
        language: input.language,
        terms: input.terms,
      });
      if (!run.ok) {
        return {
          mode: "failed",
          failureReason: `${deepgramNoCreditsReason} OpenAI Whisper fallback also failed: ${run.failureReason}`,
        };
      }
      return {
        mode: "sync",
        result: run.result,
        providerRequestId: run.providerRequestId,
      };
    }
    throw err;
  }
  return { mode: "callback" };
}
