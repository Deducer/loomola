import { describe, expect, it } from "vitest";
import {
  DEFAULT_OBSIDIAN_VAULT_PATH,
  normalizeObsidianPath,
  resolveObsidianPath,
} from "@/lib/notes/obsidian-path";
import {
  buildNoteMarkdown,
  noteExportFilename,
  type NoteExportPayload,
} from "@/lib/notes/export";

describe("Obsidian note export", () => {
  it("uses Ian's inbox as the global default path", () => {
    expect(DEFAULT_OBSIDIAN_VAULT_PATH).toBe(
      "/Users/iancross/Obsidian_Vaults/The Vault/0 - Inbox"
    );
    expect(
      normalizeObsidianPath(
        "/Users/iancross/Obsidian_Vaults/The Vault/0 - Inbox\\"
      )
    ).toBe(DEFAULT_OBSIDIAN_VAULT_PATH);
    expect(resolveObsidianPath({})).toBe(DEFAULT_OBSIDIAN_VAULT_PATH);
  });

  it("builds canonical markdown with frontmatter and transcript speakers", () => {
    const payload = basePayload();
    const markdown = buildNoteMarkdown(payload);

    expect(markdown).toContain('meeting_id: "media-1"');
    expect(markdown).toContain(
      'obsidian_path: "/Users/iancross/Obsidian_Vaults/The Vault/0 - Inbox"'
    );
    expect(markdown).toContain("## Enhanced Notes");
    expect(markdown).toContain("### Ian");
    expect(markdown).toContain("[0:03] We should ship the export flow.");
  });

  it("uses a stable filename", () => {
    expect(noteExportFilename(basePayload(), "md")).toBe(
      "2026-05-01-export-test.md"
    );
  });
});

function basePayload(): NoteExportPayload {
  return {
    generatedAt: "2026-05-02T00:00:00.000Z",
    appUrl: "https://loom.dissonance.cloud/notes/export-test",
    audioUrl: null,
    resolvedObsidianPath: DEFAULT_OBSIDIAN_VAULT_PATH,
    media: {
      id: "media-1",
      slug: "export-test",
      title: "Export Test",
      status: "ready",
      createdAt: "2026-05-01T20:08:00.000Z",
      durationSeconds: 49,
      meetingDetectedApp: null,
      sourceContextHint: null,
    },
    project: null,
    note: {
      body: "Raw typed notes.",
      updatedAt: "2026-05-01T20:09:00.000Z",
    },
    enhanced: {
      titleSuggested: "Export Test",
      summary: "## Overview\n\nA test export.",
      actionItems: null,
      generationStatus: "complete",
      generatedAt: "2026-05-01T20:10:00.000Z",
    },
    transcript: {
      fullText: "We should ship the export flow.",
      language: "en",
      provider: "deepgram",
      paragraphs: [
        {
          speaker: "Ian",
          startSec: 3,
          endSec: 8,
          text: "We should ship the export flow.",
        },
      ],
    },
  };
}
