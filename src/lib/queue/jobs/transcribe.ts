import { presignGet } from "@/lib/r2/presigned-get";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCanonicalTerms } from "@/db/queries/dictionary-terms";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { deepgramLanguageOption } from "@/lib/preferences/user-preferences";
import { setRecordingFailed } from "@/db/queries/recordings";
import { submitTranscription } from "@/lib/transcription/submit";
import { persistTranscriptAndFanOut } from "@/lib/transcription/persist";

export const TRANSCRIBE_JOB = "transcribe";

export type TranscribeJobData = {
  mediaObjectId: string;
  audioKey?: string;
  compositeKey?: string;
  multichannel?: boolean;
};

/**
 * Provider-dispatched transcription (TRANSCRIBE_PROVIDER):
 * - deepgram (default): async — submits with a signed callback URL; the
 *   job completes when Deepgram ACKs and the webhook persists + fans out.
 * - openai-whisper: sync — extracts audio, POSTs to OpenAI inside this
 *   job, then runs the SAME persist + fan-out the webhook runs. No
 *   public callback URL needed (localhost/LAN self-hosting works).
 *
 * Terminal failures (Deepgram 402, OpenAI auth/quota, >25MB audio) mark
 * the recording failed with a human-readable failure_reason; the owner
 * Retry button re-enqueues this same job, so switching providers between
 * attempts also Just Works.
 */
export async function runTranscribeJob(data: TranscribeJobData): Promise<void> {
  const { mediaObjectId } = data;
  const sourceKey = data.audioKey ?? data.compositeKey;
  if (!sourceKey) throw new Error("transcribe job requires audioKey");

  const audioUrl = await presignGet(sourceKey);
  const ownerId = await getMediaOwnerId(mediaObjectId);
  const preferences = ownerId ? await getUserPreferences(ownerId) : null;
  const language = deepgramLanguageOption(preferences?.transcriptionLanguage);
  const canonical = ownerId ? await getCanonicalTerms(ownerId) : [];
  const terms = canonical.slice(0, 100).map((term) => term.term);

  const outcome = await submitTranscription({
    mediaObjectId,
    audioUrl,
    multichannel: data.multichannel === true,
    language,
    terms,
  });

  if (outcome.mode === "failed") {
    await setRecordingFailed(mediaObjectId, outcome.failureReason);
    console.error(
      `[transcribe] terminal failure for media ${mediaObjectId}: ${outcome.failureReason}`
    );
    return;
  }

  if (outcome.mode === "callback") {
    console.log(
      `[transcribe] submitted Deepgram request for media ${mediaObjectId}`
    );
    return;
  }

  const persisted = await persistTranscriptAndFanOut({
    mediaObjectId,
    provider: "openai-whisper",
    providerRequestId: outcome.providerRequestId,
    transcript: outcome.result,
  });
  console.log(
    `[transcribe] whisper transcript persisted for media ${mediaObjectId} (${persisted.kind}, ${
      persisted.kind === "not_found" ? 0 : persisted.wordCount
    } words)`
  );
}

async function getMediaOwnerId(mediaObjectId: string): Promise<string | null> {
  const [media] = await db
    .select({ ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  return media?.ownerId ?? null;
}
