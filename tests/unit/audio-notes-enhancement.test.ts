import { describe, expect, it } from "vitest";
import { buildAudioNotesEnhancementPrompt } from "@/lib/queue/jobs/generate-title-summary";

describe("buildAudioNotesEnhancementPrompt", () => {
  it("anchors the prompt on raw notes and transcript context", () => {
    const prompt = buildAudioNotesEnhancementPrompt({
      title: "Customer call",
      rawNotes: "- Aman: pissed about Q2 numbers",
      transcript: "Aman said the Q2 numbers need a follow-up by Friday.",
    });

    expect(prompt).toContain("Customer call");
    expect(prompt).toContain("- Aman: pissed about Q2 numbers");
    expect(prompt).toContain("Aman said the Q2 numbers");
    expect(prompt).toContain("Preserve verbatim");
    expect(prompt).toContain("Do not invent");
  });
});
