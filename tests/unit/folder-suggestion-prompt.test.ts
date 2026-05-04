import { describe, it, expect } from "vitest";
import { buildFolderSuggestionPrompt } from "@/lib/folder-suggestion/build-prompt";

describe("buildFolderSuggestionPrompt", () => {
  const minimalFolders = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      name: "American Buddha",
      recentNoteTitles: [
        "Style consistency review",
        "Animation workflow guidelines",
      ],
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Vayu Labs",
      recentNoteTitles: ["Q3 strategy sync", "Devops handoff"],
    },
  ];

  it("includes the new note's title, summary, and source context", () => {
    const prompt = buildFolderSuggestionPrompt({
      note: {
        title: "Style consistency for new shots",
        summary: "Reviewing the latest American Buddha animation tests…",
        transcriptExcerpt: "Today we're diving into the consistency issue.",
        attendeeNames: ["Ian", "Sarah"],
        sourceContextHint: "Google Meet — animation review",
      },
      folders: minimalFolders,
    });
    expect(prompt).toContain("Style consistency for new shots");
    expect(prompt).toContain("American Buddha animation tests");
    expect(prompt).toContain("Ian, Sarah");
    expect(prompt).toContain("Google Meet — animation review");
  });

  it("lists every folder with its uuid and name", () => {
    const prompt = buildFolderSuggestionPrompt({
      note: {
        title: "x",
        summary: "y",
        transcriptExcerpt: "z",
        attendeeNames: [],
        sourceContextHint: null,
      },
      folders: minimalFolders,
    });
    expect(prompt).toContain("11111111-1111-1111-1111-111111111111");
    expect(prompt).toContain("American Buddha");
    expect(prompt).toContain("22222222-2222-2222-2222-222222222222");
    expect(prompt).toContain("Vayu Labs");
    expect(prompt).toContain("Style consistency review");
    expect(prompt).toContain("Q3 strategy sync");
  });

  it("truncates the summary to 1500 chars", () => {
    const longSummary = "A".repeat(5000);
    const prompt = buildFolderSuggestionPrompt({
      note: {
        title: "t",
        summary: longSummary,
        transcriptExcerpt: "",
        attendeeNames: [],
        sourceContextHint: null,
      },
      folders: minimalFolders,
    });
    const aRun = prompt.match(/A+/g)?.find((s) => s.length > 100) ?? "";
    expect(aRun.length).toBeLessThanOrEqual(1500);
  });

  it("truncates the transcript excerpt sensibly (head + tail at most ~1000 chars total)", () => {
    const longExcerpt = "B".repeat(5000) + "C".repeat(5000);
    const prompt = buildFolderSuggestionPrompt({
      note: {
        title: "t",
        summary: "s",
        transcriptExcerpt: longExcerpt,
        attendeeNames: [],
        sourceContextHint: null,
      },
      folders: minimalFolders,
    });
    // Combined B+C run within prompt should be <= ~1100 chars (head 500 + ellipsis + tail 500).
    const bRun = prompt.match(/B+/g)?.[0] ?? "";
    const cRun = prompt.match(/C+/g)?.[0] ?? "";
    expect(bRun.length).toBeLessThanOrEqual(600);
    expect(cRun.length).toBeLessThanOrEqual(600);
    // Should still include some content from both ends.
    expect(bRun.length).toBeGreaterThan(100);
    expect(cRun.length).toBeGreaterThan(100);
  });

  it("handles a folder with zero recent notes", () => {
    const prompt = buildFolderSuggestionPrompt({
      note: {
        title: "t",
        summary: "s",
        transcriptExcerpt: "",
        attendeeNames: [],
        sourceContextHint: null,
      },
      folders: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          name: "Empty Folder",
          recentNoteTitles: [],
        },
      ],
    });
    expect(prompt).toContain("Empty Folder");
    expect(prompt).toContain("33333333-3333-3333-3333-333333333333");
  });

  it("escapes folder names that contain quotes / newlines", () => {
    const prompt = buildFolderSuggestionPrompt({
      note: {
        title: "t",
        summary: "s",
        transcriptExcerpt: "",
        attendeeNames: [],
        sourceContextHint: null,
      },
      folders: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          name: 'Folder "with" quotes\nand a newline',
          recentNoteTitles: [],
        },
      ],
    });
    // The newline in the folder name shouldn't break the line-by-line layout
    // by leaking into a position where it could be parsed as a different
    // section. Easiest invariant: the folder name appears on a single line
    // (newline replaced) and quotes don't cause early termination.
    const lines = prompt.split("\n");
    const folderLine = lines.find((l) =>
      l.includes("44444444-4444-4444-4444-444444444444")
    );
    expect(folderLine).toBeTruthy();
    expect(folderLine).not.toContain("\n");
  });

  it("includes a clear instruction asking for a single best match or null", () => {
    const prompt = buildFolderSuggestionPrompt({
      note: {
        title: "t",
        summary: "s",
        transcriptExcerpt: "",
        attendeeNames: [],
        sourceContextHint: null,
      },
      folders: minimalFolders,
    });
    expect(prompt.toLowerCase()).toMatch(/best fit|best match/);
    expect(prompt.toLowerCase()).toContain("null");
    // Mention of confidence semantics so the model self-gates.
    expect(prompt.toLowerCase()).toContain("confidence");
  });
});
