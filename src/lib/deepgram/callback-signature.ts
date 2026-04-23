import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const secret = process.env.DEEPGRAM_CALLBACK_SIGNING_SECRET;
  if (!secret) {
    throw new Error("DEEPGRAM_CALLBACK_SIGNING_SECRET is not set");
  }
  return secret;
}

/** Produces a hex HMAC-SHA256 of the recording id. */
export function signRecordingId(recordingId: string): string {
  return createHmac("sha256", getSecret()).update(recordingId).digest("hex");
}

/** Constant-time compare; returns false on any mismatch or malformed input. */
export function verifyRecordingSignature(
  recordingId: string,
  signature: string
): boolean {
  if (!signature) return false;
  const expected = signRecordingId(recordingId);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
