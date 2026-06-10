/** OpenAI's documented upload cap for /v1/audio/transcriptions. */
export const OPENAI_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * v1 is reject-not-chunk: the extracted 16kHz mono 56kbps AAC stays under
 * 25MB for roughly an hour of audio; anything longer fails with a reason
 * that names the limit and the escape hatch.
 */
export function whisperOversizeReason(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return (
    `Transcription failed: the extracted audio is ${mb}MB, over OpenAI's ` +
    `25MB transcription upload limit (~1 hour of audio). Use ` +
    `TRANSCRIBE_PROVIDER=deepgram for long recordings, then Retry.`
  );
}

export type WhisperHttpVerdict =
  | { terminal: true; reason: string }
  | { terminal: false };

/**
 * Decides whether an OpenAI transcription HTTP failure is retryable.
 * Terminal verdicts mark the recording failed immediately (the reason is
 * the user-facing failure_reason); everything else is thrown so pg-boss
 * retries with the same options as the Deepgram path (3x, backoff).
 */
export function classifyWhisperHttpFailure(
  status: number,
  body: string
): WhisperHttpVerdict {
  if (status === 401 || status === 403) {
    return {
      terminal: true,
      reason:
        "Transcription failed: OpenAI rejected the API key (check OPENAI_API_KEY).",
    };
  }
  if (status === 413) {
    return {
      terminal: true,
      reason:
        "Transcription failed: OpenAI rejected the audio as too large (25MB limit). Use TRANSCRIBE_PROVIDER=deepgram for long recordings, then Retry.",
    };
  }
  if (
    status === 429 &&
    /insufficient_quota|exceeded your current quota/i.test(body)
  ) {
    return {
      terminal: true,
      reason:
        "Transcription failed: the OpenAI account is out of credits (insufficient_quota).",
    };
  }
  if (status === 400) {
    return {
      terminal: true,
      reason: `Transcription failed: OpenAI rejected the request (400): ${body.slice(0, 200)}`,
    };
  }
  return { terminal: false };
}
