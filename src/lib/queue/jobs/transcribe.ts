import { getDeepgramClient } from "@/lib/deepgram/client";
import { presignGet } from "@/lib/r2/presigned-get";
import { signRecordingId } from "@/lib/deepgram/callback-signature";

export const TRANSCRIBE_JOB = "transcribe";

export type TranscribeJobData = {
  mediaObjectId: string;
  compositeKey: string;
};

/**
 * Sends a Deepgram async prerecorded request pointing at the composite R2
 * URL. Deepgram will POST the transcript to our webhook when ready. The
 * job itself completes as soon as Deepgram ACKs the request; the webhook
 * handler persists the transcript to the DB and flips status to 'ready'.
 *
 * The HMAC signature is carried as a path segment (not a query string) so
 * Deepgram's URL-encoding of our callback URL into its own query string
 * can't double-encode or mangle it.
 */
export async function runTranscribeJob(data: TranscribeJobData): Promise<void> {
  const { mediaObjectId, compositeKey } = data;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");

  const audioUrl = await presignGet(compositeKey);
  const sig = signRecordingId(mediaObjectId);
  const callbackUrl = `${appUrl}/api/webhooks/deepgram/${mediaObjectId}/${sig}`;

  const dg = getDeepgramClient();
  await dg.listen.v1.media.transcribeUrl({
    url: audioUrl,
    callback: callbackUrl,
    model: "nova-2",
    smart_format: true,
    language: "en",
  });

  console.log(
    `[transcribe] submitted Deepgram request for media ${mediaObjectId}`
  );
}
