import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  buildTemplateInstruction,
  getNoteTemplate,
  isSystemNoteTemplateId,
  listNoteTemplates,
} from "@/lib/ai/note-templates";

describe("note templates", () => {
  it("ships a focused system template library", () => {
    const templates = listNoteTemplates();

    expect(templates.length).toBeGreaterThanOrEqual(10);
    expect(templates.map((template) => template.id)).toContain("one-to-one");
    expect(templates.map((template) => template.id)).toContain("content-summary");
    expect(templates.map((template) => template.id)).toContain(
      "sydney-ian-relationship-call"
    );
    expect(templates.map((template) => template.id)).toContain(
      "living-flow-next-level-group-call"
    );
    expect(templates.map((template) => template.id)).toContain(
      "project-win-weekly-sync"
    );
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

  it("renders the Living Flow group call template instructions", () => {
    const instruction = buildTemplateInstruction(
      getNoteTemplate("living-flow-next-level-group-call")
    );

    expect(instruction).toContain("Template: Living Flow Next Level group call");
    expect(instruction).toContain("opening meditation");
    expect(instruction).toContain("Javier's teaching");
    expect(instruction).toContain("Group Q&A");
    expect(instruction).toContain("silent meditation periods");
  });

  it("renders the Sydney and Ian relationship call template instructions", () => {
    const instruction = buildTemplateInstruction(
      getNoteTemplate("sydney-ian-relationship-call")
    );

    expect(instruction).toContain("Template: Sydney and Ian relationship call");
    expect(instruction).toContain("social and romantic context");
    expect(instruction).toContain("Sydney is the remote call audio");
    expect(instruction).toContain("Relationship signals");
    expect(instruction).toContain("Questions to revisit");
  });

  it("renders the Project Win weekly sync template instructions", () => {
    const instruction = buildTemplateInstruction(
      getNoteTemplate("project-win-weekly-sync")
    );

    expect(instruction).toContain("Template: Project Win weekly sync");
    expect(instruction).toContain("Ian is the user");
    expect(instruction).toContain("Abb is the remote call audio");
    expect(instruction).toContain("singular-owner action items");
    expect(instruction).toContain("Ideas and opportunities");
  });
});
