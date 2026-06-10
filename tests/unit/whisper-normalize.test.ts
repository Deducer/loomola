import { describe, expect, it } from "vitest";
import {
  normalizeWhisperTranscript,
  whisperLanguageToIso,
} from "@/lib/transcription/whisper-normalize";

describe("normalizeWhisperTranscript", () => {
  it("interpolates punctuated word timings across each segment, speaker 0", () => {
    const out = normalizeWhisperTranscript({
      task: "transcribe",
      language: "english",
      duration: 4,
      text: "Hello there. General Kenobi!",
      segments: [
        { start: 0, end: 2, text: " Hello there." },
        { start: 2, end: 4, text: " General Kenobi!" },
      ],
    });
    expect(out.fullText).toBe("Hello there. General Kenobi!");
    expect(out.language).toBe("en");
    expect(out.wordTimestamps).toEqual([
      { word: "Hello", start: 0, end: 1, speaker: 0 },
      { word: "there.", start: 1, end: 2, speaker: 0 },
      { word: "General", start: 2, end: 3, speaker: 0 },
      { word: "Kenobi!", start: 3, end: 4, speaker: 0 },
    ]);
  });

  it("keeps punctuation on tokens (panel renders the word array)", () => {
    const out = normalizeWhisperTranscript({
      segments: [{ start: 0, end: 1, text: "Yes, really?" }],
    });
    expect(out.wordTimestamps.map((w) => w.word)).toEqual(["Yes,", "really?"]);
  });

  it("orders out-of-order segments and skips empty ones", () => {
    const out = normalizeWhisperTranscript({
      text: "b a",
      segments: [
        { start: 5, end: 6, text: "b" },
        { start: 0, end: 1, text: "   " },
        { start: 1, end: 2, text: "a" },
      ],
    });
    expect(out.wordTimestamps.map((w) => w.word)).toEqual(["a", "b"]);
  });

  it("falls back to a single synthetic segment when segments are missing", () => {
    const out = normalizeWhisperTranscript({ text: "just text", duration: 2 });
    expect(out.fullText).toBe("just text");
    expect(out.wordTimestamps).toEqual([
      { word: "just", start: 0, end: 1, speaker: 0 },
      { word: "text", start: 1, end: 2, speaker: 0 },
    ]);
  });

  it("returns an empty transcript for an empty response", () => {
    const out = normalizeWhisperTranscript({});
    expect(out.fullText).toBe("");
    expect(out.wordTimestamps).toEqual([]);
    expect(out.language).toBe("en");
  });
});

describe("whisperLanguageToIso", () => {
  it("maps verbose_json language names to ISO codes", () => {
    expect(whisperLanguageToIso("english")).toBe("en");
    expect(whisperLanguageToIso("Spanish")).toBe("es");
    expect(whisperLanguageToIso("japanese")).toBe("ja");
  });
  it("passes through ISO-looking codes and defaults unknowns to en", () => {
    expect(whisperLanguageToIso("de")).toBe("de");
    expect(whisperLanguageToIso("pt-br")).toBe("pt-br");
    expect(whisperLanguageToIso("klingon")).toBe("en");
    expect(whisperLanguageToIso(undefined)).toBe("en");
  });
});
