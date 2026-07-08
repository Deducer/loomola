import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  buildTemplateInstruction,
  getNoteTemplate,
  isSystemNoteTemplateId,
  listNoteTemplates,
} from "@/lib/ai/note-templates";

describe("note templates", () => {
  it("ships a focused system template library with no personal templates", () => {
    const templates = listNoteTemplates();

    expect(templates.length).toBeGreaterThanOrEqual(10);
    expect(templates.map((template) => template.id)).toContain("one-to-one");
    expect(templates.map((template) => template.id)).toContain("content-summary");

    // Stage 18: personal templates moved to per-user note_templates rows —
    // a public codebase must never carry anyone's private meeting shapes.
    for (const template of templates) {
      expect(template.category).not.toBe("Personal");
    }
  });

  it("falls back to the default template for unknown ids", () => {
    expect(getNoteTemplate("missing").id).toBe(DEFAULT_NOTE_TEMPLATE_ID);
    expect(isSystemNoteTemplateId("missing")).toBe(false);
    expect(isSystemNoteTemplateId("customer-discovery")).toBe(true);
  });

  it("renders prompt instructions from template sections", () => {
    const instruction = buildTemplateInstruction(getNoteTemplate("product-demo"));

    expect(instruction).toContain("Template: Product demo");
    expect(instruction).toContain("Demo flow");
    expect(instruction).toContain("Questions and objections");
  });
});
