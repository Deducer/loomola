import { describe, expect, it } from "vitest";
import { noteTranscriptState } from "@/lib/notes/transcript-state";

const base = {
  transcriptTextLength: null as number | null,
  transcriptProvider: null as string | null,
  r2MixedKey: "mixed.wav" as string | null,
  r2MicKey: null as string | null,
  r2SystemaudioKey: null as string | null,
};

describe("noteTranscriptState", () => {
  it("reports a missing transcript as retryable", () => {
    const state = noteTranscriptState(base);
    expect(state.transcriptState).toBe("missing");
    expect(state.canRetryTranscript).toBe(true);
  });

  it("reports an empty batch transcript as retryable", () => {
    const state = noteTranscriptState({
      ...base,
      transcriptTextLength: 0,
      transcriptProvider: "deepgram",
    });
    expect(state.transcriptState).toBe("empty");
    expect(state.canRetryTranscript).toBe(true);
  });

  it("treats a live-only transcript as retryable but usable", () => {
    // 2026-11-04: the batch callback came back empty for a quiet capture,
    // the 20-word live snapshot survived, and nothing offered a retry.
    const state = noteTranscriptState({
      ...base,
      transcriptTextLength: 120,
      transcriptProvider: "deepgram-live",
    });
    expect(state.transcriptState).toBe("live");
    expect(state.transcriptTextLength).toBe(120);
    expect(state.canRetryTranscript).toBe(true);
  });

  it("locks a batch transcript with text out of retry", () => {
    const state = noteTranscriptState({
      ...base,
      transcriptTextLength: 120,
      transcriptProvider: "deepgram",
    });
    expect(state.transcriptState).toBe("ready");
    expect(state.canRetryTranscript).toBe(false);
  });

  it("never offers retry without any audio to re-run", () => {
    const state = noteTranscriptState({
      ...base,
      r2MixedKey: null,
      transcriptTextLength: 120,
      transcriptProvider: "deepgram-live",
    });
    expect(state.transcriptState).toBe("live");
    expect(state.canRetryTranscript).toBe(false);
  });
});
