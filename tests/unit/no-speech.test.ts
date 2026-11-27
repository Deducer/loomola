import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  isNoSpeechTranscript,
  noSpeechSql,
  transcriptTextIsEmpty,
} from "@/lib/transcript/no-speech";

describe("transcriptTextIsEmpty", () => {
  it("treats empty and whitespace-only text as empty", () => {
    expect(transcriptTextIsEmpty("")).toBe(true);
    expect(transcriptTextIsEmpty("   \n\t ")).toBe(true);
  });

  it("treats any word as speech", () => {
    expect(transcriptTextIsEmpty("hi")).toBe(false);
    expect(transcriptTextIsEmpty("  okay.  ")).toBe(false);
  });
});

describe("isNoSpeechTranscript", () => {
  it("is false when there is no transcript yet", () => {
    expect(isNoSpeechTranscript(null)).toBe(false);
    expect(isNoSpeechTranscript(undefined)).toBe(false);
  });

  it("is true for a finished transcript with no text", () => {
    expect(isNoSpeechTranscript({ fullText: "", provider: "deepgram" })).toBe(true);
    expect(isNoSpeechTranscript({ fullText: "  " })).toBe(true);
  });

  it("is false for a transcript with words", () => {
    expect(
      isNoSpeechTranscript({ fullText: "Hello there", provider: "deepgram" })
    ).toBe(false);
  });

  it("ignores an empty live-caption snapshot (the batch pass may still find words)", () => {
    expect(
      isNoSpeechTranscript({ fullText: "", provider: "deepgram-live" })
    ).toBe(false);
  });
});

describe("noSpeechSql", () => {
  it("renders the same rule in SQL (transcript present, not live, no non-space char)", () => {
    const { sql } = new PgDialect().sqlToQuery(noSpeechSql);
    expect(sql).toContain('"transcripts"."id" is not null');
    expect(sql).toContain("<> 'deepgram-live'");
    expect(sql).toContain("!~ '\\S'");
  });
});
