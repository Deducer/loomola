import { describe, expect, it } from "vitest";
import {
  buildAudioNoteTitlePrompt,
  buildAudioNotesEnhancementMessages,
  buildAudioNotesEnhancementPrompt,
  minimumEnhancedNotesChars,
  validateAudioNotesEnhancement,
} from "@/lib/queue/jobs/generate-title-summary";
import { getNoteTemplate } from "@/lib/ai/note-templates";
import { normalizeGeneratedNotesMarkdown } from "@/lib/ai/normalize-generated-notes";

describe("buildAudioNotesEnhancementPrompt", () => {
  it("keeps generated titles short enough for the desktop header", () => {
    const prompt = buildAudioNoteTitlePrompt({
      sourceContextHint: "Zoom: Documentary film production weekly progress",
      generatedNotes:
        "# Highlights\n\n- The team discussed reviewer feedback, imagery, voiceover, and next cuts.",
    });

    expect(prompt).toContain("3 to 8 words");
    expect(prompt).toContain("70 characters or fewer");
    expect(prompt).toContain("No subtitles, dashes, or colon-separated second clauses");
  });

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
    expect(prompt).toContain("Use the entire transcript");
    expect(prompt).toContain("Do not use markdown tables or horizontal rules");
    expect(prompt).toContain("Never write a line that is only `---`");
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

  it("rejects tiny completed notes for long transcripts", () => {
    const transcript = "Customer and team discussed the project. ".repeat(3000);
    const minChars = minimumEnhancedNotesChars(transcript.trim().length);
    expect(minChars).toBeGreaterThan(700);

    expect(
      validateAudioNotesEnhancement({
        transcript,
        summary: "## Highlights\n\n- One short bullet.",
        finishReason: "stop",
      })
    ).toEqual({
      ok: false,
      reason: `summary too short for transcript (34 < ${minChars} chars)`,
    });
  });

  it("rejects outputs that ended because of the token limit", () => {
    expect(
      validateAudioNotesEnhancement({
        transcript: "Short transcript.",
        summary: "## Summary\n\nUseful notes.",
        finishReason: "length",
      })
    ).toEqual({
      ok: false,
      reason: "model hit output token limit",
    });
  });

  it("rejects long-transcript summaries that end mid-phrase", () => {
    expect(
      validateAudioNotesEnhancement({
        transcript: "A long meeting transcript. ".repeat(300),
        summary: "## Highlights\n\n- The team decided to",
        finishReason: "stop",
      })
    ).toEqual({
      ok: false,
      reason: "summary appears abruptly truncated",
    });
  });
});

describe("normalizeGeneratedNotesMarkdown", () => {
  it("converts task tables into bullets and removes generated dividers", () => {
    const normalized = normalizeGeneratedNotesMarkdown(`
## Next Week

| Task | Owner | Notes |
|------|-------|-------|
| Retry first sequence shot | Omar | Report back Monday |
| Check timeline | Ian/Jeremy | Sarah traveling overseas |

---

- ****Reviewer notes**** arrived.
`);

    expect(normalized).not.toContain("| Task | Owner | Notes |");
    expect(normalized).not.toContain("|------|-------|-------|");
    expect(normalized).not.toMatch(/(^|\n)\s*---\s*(\n|$)/);
    expect(normalized).not.toContain("****");
    expect(normalized).toContain("- **Retry first sequence shot** (Omar): Report back Monday");
    expect(normalized).toContain("- **Check timeline** (Ian/Jeremy): Sarah traveling overseas");
    expect(normalized).toContain("- **Reviewer notes** arrived.");
  });
});
