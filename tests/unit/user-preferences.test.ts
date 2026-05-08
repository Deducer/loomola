import { describe, expect, it } from "vitest";
import {
  buildSummaryLanguageInstruction,
  deepgramLanguageOption,
  userPreferencesPatchSchema,
} from "@/lib/preferences/user-preferences";

describe("user preferences", () => {
  it("omits Deepgram language when auto-detect is selected", () => {
    expect(deepgramLanguageOption("auto")).toBeUndefined();
    expect(deepgramLanguageOption("en")).toBe("en");
    expect(deepgramLanguageOption(null)).toBe("en");
  });

  it("validates persisted preference patches", () => {
    expect(
      userPreferencesPatchSchema.safeParse({
        transcriptionLanguage: "es",
        summaryLanguage: "same-as-transcript",
        transcriptRetentionDays: null,
        notifyComments: false,
      }).success
    ).toBe(true);

    expect(
      userPreferencesPatchSchema.safeParse({
        transcriptionLanguage: "klingon",
      }).success
    ).toBe(false);
  });

  it("renders explicit summary language instructions", () => {
    expect(
      buildSummaryLanguageInstruction({
        summaryLanguage: "same-as-transcript",
        transcriptLanguage: "es",
      })
    ).toContain("match the transcript language (es)");

    expect(
      buildSummaryLanguageInstruction({ summaryLanguage: "fr" })
    ).toContain("French");
  });
});
