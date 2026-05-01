import { describe, expect, it } from "vitest";
import {
  buildVariantReplacementMap,
  collapseDictionaryVariants,
} from "@/lib/dictionary/transcript-rewrite";

describe("dictionary transcript rewrite", () => {
  it("builds variant to canonical replacements", () => {
    const replacements = buildVariantReplacementMap([
      { id: "1", term: "Aman", variantOf: null },
      { id: "2", term: "Amaan", variantOf: "1" },
    ]);

    expect(replacements.get("amaan")).toBe("Aman");
  });

  it("rewrites full text and timestamp words", () => {
    const replacements = new Map([["amaan", "Aman"]]);
    const result = collapseDictionaryVariants(
      "Amaan said hello to amaan.",
      [
        { word: "Amaan", start: 0, end: 0.5 },
        { word: "amaan.", start: 1, end: 1.5 },
      ],
      replacements
    );

    expect(result.fullText).toBe("Aman said hello to Aman.");
    expect(result.words.map((word) => word.word)).toEqual(["Aman", "Aman."]);
  });
});
