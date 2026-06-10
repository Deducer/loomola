// Pure stage decision for retrying a failed recording. Productizes the
// logic of scripts/retrigger-stuck-transcripts.mjs (no transcript) and
// scripts/requeue-ai-jobs.mjs (transcript exists).

export type RetryDecision =
  | { kind: "transcribe"; sourceKey: string; isAudioSource: boolean }
  | { kind: "ai" }
  | { kind: "audio-ready" }
  | { kind: "unrecoverable"; message: string };

export function decideRetryStage(input: {
  type: "video" | "audio";
  hasTranscript: boolean;
  r2MixedKey: string | null;
  r2CompositeKey: string | null;
  r2MicKey: string | null;
  r2SystemaudioKey: string | null;
}): RetryDecision {
  if (!input.hasTranscript) {
    // Same precedence as retrigger-stuck-transcripts.mjs, extended with the
    // raw audio tracks as a last resort for audio notes that failed before
    // mixing.
    const sourceKey =
      input.r2MixedKey ??
      input.r2CompositeKey ??
      input.r2MicKey ??
      input.r2SystemaudioKey;
    if (!sourceKey) {
      return {
        kind: "unrecoverable",
        message:
          "No uploaded media to transcribe — the upload never finished. Record again.",
      };
    }
    return {
      kind: "transcribe",
      sourceKey,
      isAudioSource: input.type === "audio",
    };
  }
  if (input.type === "audio") return { kind: "audio-ready" };
  return { kind: "ai" };
}
