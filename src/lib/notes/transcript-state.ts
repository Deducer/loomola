/**
 * One reading of "where is this note's transcript" shared by the enhance
 * status route and the transcript retry route, so the desktop and the
 * retry gate can never disagree about whether a retry is allowed.
 *
 *  - missing: no transcript row yet (upload / batch still running).
 *  - empty:   a batch pass finished with no words.
 *  - live:    only the live-streaming snapshot exists. Good enough to
 *             generate notes from, but the batch pass either never
 *             landed or came back empty (2026-11-04: a quiet capture),
 *             so a retry should still be offered.
 *  - ready:   a batch transcript with text. Retry is locked.
 */
export type NoteTranscriptState = "missing" | "empty" | "live" | "ready";

export const LIVE_TRANSCRIPT_PROVIDER = "deepgram-live";

export function noteTranscriptState(data: {
  transcriptTextLength: number | null;
  transcriptProvider: string | null;
  r2MixedKey: string | null;
  r2MicKey: string | null;
  r2SystemaudioKey: string | null;
}) {
  const transcriptTextLength = data.transcriptTextLength ?? 0;
  let transcriptState: NoteTranscriptState;
  if (data.transcriptTextLength == null) {
    transcriptState = "missing";
  } else if (transcriptTextLength === 0) {
    transcriptState = "empty";
  } else if (data.transcriptProvider === LIVE_TRANSCRIPT_PROVIDER) {
    transcriptState = "live";
  } else {
    transcriptState = "ready";
  }
  const audioSourceKey =
    data.r2MixedKey ?? data.r2MicKey ?? data.r2SystemaudioKey;
  const canRetryTranscript =
    transcriptState !== "ready" && Boolean(audioSourceKey);

  return {
    transcriptTextLength,
    transcriptState,
    audioSourceKey,
    canRetryTranscript,
  };
}
