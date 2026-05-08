import { describe, expect, it } from "vitest";
import {
  buildAudioNotesEnhancementMessages,
  buildAudioNotesEnhancementPrompt,
} from "@/lib/queue/jobs/generate-title-summary";
import { getNoteTemplate } from "@/lib/ai/note-templates";

describe("buildAudioNotesEnhancementPrompt", () => {
  it("anchors the prompt on raw notes and transcript context", () => {
    const prompt = buildAudioNotesEnhancementPrompt({
      title: "Customer call",
      sourceContextHint: "Google Meet: Customer Q2 review",
      attachmentNames: ["pricing-slide.png"],
      rawNotes: "- Aman: pissed about Q2 numbers",
      transcript: "Aman said the Q2 numbers need a follow-up by Friday.",
    });

    expect(prompt).toContain("Customer call");
    expect(prompt).toContain("Google Meet: Customer Q2 review");
    expect(prompt).toContain("pricing-slide.png");
    expect(prompt).toContain("- Aman: pissed about Q2 numbers");
    expect(prompt).toContain("Aman said the Q2 numbers");
    expect(prompt).toContain("Use attached images");
    expect(prompt).toContain("Preserve verbatim");
    expect(prompt).toContain("Do not invent");
  });

  it("adds the selected template instructions", () => {
    const prompt = buildAudioNotesEnhancementPrompt({
      title: "Aman 1:1",
      template: getNoteTemplate("one-to-one"),
      outputLanguageInstruction: "Output language: French.",
      rawNotes: "- blocked on customer rollout",
      transcript: "We discussed blockers and mutual feedback.",
    });

    expect(prompt).toContain("Template: 1 to 1");
    expect(prompt).toContain("Top of mind");
    expect(prompt).toContain("Mutual feedback");
    expect(prompt).toContain("Selected template id: one-to-one");
    expect(prompt).toContain("Output language: French.");
  });

  it("includes attached images as model image parts", () => {
    const messages = buildAudioNotesEnhancementMessages({
      prompt: "Use the screenshot.",
      imageAttachments: [
        {
          url: "https://example.com/screenshot.png",
          contentType: "image/png",
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toEqual([
      { type: "text", text: "Use the screenshot." },
      {
        type: "image",
        image: new URL("https://example.com/screenshot.png"),
        mediaType: "image/png",
      },
    ]);
  });
});
