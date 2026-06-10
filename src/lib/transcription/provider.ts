export const TRANSCRIBE_PROVIDERS = ["deepgram", "openai-whisper"] as const;
export type TranscribeProvider = (typeof TRANSCRIBE_PROVIDERS)[number];

/**
 * Shared default-and-trim semantics for TRANSCRIBE_PROVIDER, used by the
 * job, env-check, and doctor so "unset", "" and "  " all mean deepgram
 * everywhere. Returns the raw (possibly invalid) value otherwise.
 */
export function normalizedTranscribeProvider(
  value: string | undefined
): string {
  const v = value?.trim();
  return v ? v : "deepgram";
}

export function isTranscribeProvider(
  value: string
): value is TranscribeProvider {
  return (TRANSCRIBE_PROVIDERS as readonly string[]).includes(value);
}

export function resolveTranscribeProvider(
  value: string | undefined = process.env.TRANSCRIBE_PROVIDER
): TranscribeProvider {
  const v = normalizedTranscribeProvider(value);
  if (isTranscribeProvider(v)) return v;
  throw new Error(
    `Unknown TRANSCRIBE_PROVIDER "${v}" — expected "deepgram" or "openai-whisper"`
  );
}
