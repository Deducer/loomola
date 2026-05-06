import { describe, expect, it } from "vitest";
import {
  assignSpeakerIndices,
  normalizeSegmentsToParagraphs,
  buildImportSlug,
  detectMeetingApp,
} from "@/lib/import/granola/transform";

describe("assignSpeakerIndices", () => {
  it("assigns 0,1 in first-appearance order, skipping nulls", () => {
    const segments = [
      { granolaPersonId: "alice", text: "hi", startMs: 0, endMs: 1000 },
      { granolaPersonId: null, text: "...", startMs: 1000, endMs: 1500 },
      { granolaPersonId: "bob", text: "hey", startMs: 1500, endMs: 2500 },
      { granolaPersonId: "alice", text: "back", startMs: 2500, endMs: 3500 },
    ];
    expect(assignSpeakerIndices(segments)).toEqual({ alice: 0, bob: 1 });
  });

  it("returns empty map for all-null speakers", () => {
    expect(
      assignSpeakerIndices([
        { granolaPersonId: null, text: "x", startMs: 0, endMs: 100 },
      ])
    ).toEqual({});
  });

  it("returns empty map for empty input", () => {
    expect(assignSpeakerIndices([])).toEqual({});
  });
});

describe("normalizeSegmentsToParagraphs", () => {
  it("merges consecutive same-speaker segments into one paragraph", () => {
    const segments = [
      { granolaPersonId: "alice", text: "hi.", startMs: 0, endMs: 1000 },
      { granolaPersonId: "alice", text: "how are you?", startMs: 1000, endMs: 2000 },
      { granolaPersonId: "bob", text: "good!", startMs: 2000, endMs: 3000 },
    ];
    const speakerMap = { alice: 0, bob: 1 };
    expect(normalizeSegmentsToParagraphs(segments, speakerMap)).toEqual([
      { speaker: 0, start: 0, end: 2, text: "hi. how are you?" },
      { speaker: 1, start: 2, end: 3, text: "good!" },
    ]);
  });

  it("preserves null speaker as null in output", () => {
    const segments = [
      { granolaPersonId: null, text: "music", startMs: 0, endMs: 5000 },
    ];
    expect(normalizeSegmentsToParagraphs(segments, {})).toEqual([
      { speaker: null, start: 0, end: 5, text: "music" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeSegmentsToParagraphs([], {})).toEqual([]);
  });
});

describe("buildImportSlug", () => {
  it("produces a stable, url-safe slug from title + granolaId", () => {
    const slug = buildImportSlug("Q3 Planning Meeting", "abc-123");
    expect(slug).toMatch(/^q3-planning-meeting-[a-f0-9]{6}$/);
  });

  it("falls back to 'granola-import' prefix for empty titles", () => {
    const slug = buildImportSlug("", "xyz-789");
    expect(slug).toMatch(/^granola-import-[a-f0-9]{6}$/);
  });

  it("is deterministic for same inputs", () => {
    expect(buildImportSlug("Same Title", "id-1")).toBe(
      buildImportSlug("Same Title", "id-1")
    );
  });

  it("strips punctuation and collapses whitespace runs", () => {
    expect(buildImportSlug("Q3 / Planning! @ 10am", "x")).toMatch(
      /^q3-planning-10am-[a-f0-9]{6}$/
    );
  });
});

describe("detectMeetingApp", () => {
  it.each([
    ["https://zoom.us/j/123", "zoom"],
    ["https://us02web.zoom.us/j/123", "zoom"],
    ["https://meet.google.com/abc-defg-hij", "meet"],
    ["https://teams.microsoft.com/l/meetup-join/x", "teams"],
    ["https://other.example.com/x", null],
    [null, null],
    ["not a url", null],
  ])("%s → %s", (input, expected) => {
    expect(detectMeetingApp(input)).toBe(expected);
  });
});
