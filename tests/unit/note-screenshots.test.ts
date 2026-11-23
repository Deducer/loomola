import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatScreenshotOffset,
  parseScreenshotUpload,
  screenshotPromptLines,
  screenshotsForPrompt,
  spokenNear,
} from "@/lib/notes/screenshots";

const mocks = vi.hoisted(() => ({
  describeScreenshot: vi.fn(),
  countNoteScreenshots: vi.fn(),
  createNoteAttachment: vi.fn(),
  uploadBytes: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({ enableGranola: () => true }));
vi.mock("@/lib/require-auth", () => ({
  requireAuth: async () => ({ id: "user-1" }),
}));
vi.mock("@/lib/r2/upload-bytes", () => ({ uploadBytes: mocks.uploadBytes }));
vi.mock("@/lib/r2/presigned-get", () => ({
  presignGet: async (key: string) => `https://r2.example/${key}`,
}));
vi.mock("@/db/queries/notes", () => ({
  getAudioNoteAccess: async () => ({ id: "note-1" }),
  listNoteAttachments: async () => [],
  countNoteScreenshots: mocks.countNoteScreenshots,
  createNoteAttachment: mocks.createNoteAttachment,
  setNoteAttachmentDescription: vi.fn(),
}));
vi.mock("@/lib/ai/client", () => ({ getClassifierLlm: () => ({}) }));
vi.mock("@/lib/ai/with-fallback", () => ({ generateTextWithFallback: vi.fn() }));
vi.mock("@/lib/notes/describe-screenshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notes/describe-screenshot")>()),
  describeScreenshot: mocks.describeScreenshot,
}));

import { POST } from "@/app/api/notes/[id]/attachments/route";
import { parseScreenshotVerdict } from "@/lib/notes/describe-screenshot";
import { buildAudioNotesEnhancementPrompt } from "@/lib/queue/jobs/generate-title-summary";

const word = (text: string, start: number) => ({ word: text, start, end: start + 0.3 });

describe("parseScreenshotUpload", () => {
  it("treats an upload with no kind as a hand-attached image", () => {
    expect(parseScreenshotUpload(null, null)).toEqual({ ok: true, kind: "image" });
  });

  it("accepts a screenshot with a whole, non-negative offset", () => {
    expect(parseScreenshotUpload("screenshot", "754000")).toEqual({
      ok: true,
      kind: "screenshot",
      offsetMs: 754000,
    });
  });

  it("rejects a screenshot without a usable offset", () => {
    for (const offset of [null, "", "abc", "-1", "1.5", String(25 * 3600 * 1000)]) {
      expect(parseScreenshotUpload("screenshot", offset)).toEqual({
        ok: false,
        error: "invalid_offset",
      });
    }
  });

  it("rejects an unknown kind", () => {
    expect(parseScreenshotUpload("video", "0")).toEqual({
      ok: false,
      error: "invalid_kind",
    });
  });
});

describe("formatScreenshotOffset", () => {
  it("formats minutes and hours", () => {
    expect(formatScreenshotOffset(0)).toBe("0:00");
    expect(formatScreenshotOffset(247_900)).toBe("4:07");
    expect(formatScreenshotOffset(3_729_000)).toBe("1:02:09");
  });
});

describe("spokenNear", () => {
  const words = [
    word("before", 50),
    word("so", 99),
    word("the", 100),
    word("second", 101),
    word("milestone", 102),
    word("later", 130),
  ];

  it("quotes the words spoken just after the screenshot", () => {
    expect(spokenNear(words, 100_000)).toBe("so the second milestone");
  });

  it("returns null when almost nothing was said", () => {
    expect(spokenNear(words, 129_000)).toBeNull();
    expect(spokenNear([], 100_000)).toBeNull();
  });
});

describe("screenshotsForPrompt", () => {
  it("keeps described screenshots only, oldest first", () => {
    const rows = [
      { kind: "screenshot", offsetMs: 90_000, description: "Slide B" },
      { kind: "image", offsetMs: null, description: null },
      { kind: "screenshot", offsetMs: 30_000, description: "Slide A" },
      { kind: "screenshot", offsetMs: 60_000, description: null },
      { kind: "screenshot", offsetMs: 70_000, description: "" },
    ];
    const result = screenshotsForPrompt(rows, "not-an-array");
    expect(result.map((shot) => shot.description)).toEqual(["Slide A", "Slide B"]);
    expect(screenshotPromptLines(result)).toEqual([
      "- [0:30] Slide A",
      "- [1:30] Slide B",
    ]);
  });

  it("adds what was being said when the transcript has it", () => {
    const [line] = screenshotPromptLines(
      screenshotsForPrompt(
        [{ kind: "screenshot", offsetMs: 100_000, description: "Roadmap slide" }],
        [word("this", 100), word("is", 101), word("the", 102), word("roadmap", 103)]
      )
    );
    expect(line).toBe(
      '- [1:40] Roadmap slide (said around then: "this is the roadmap")'
    );
  });
});

describe("parseScreenshotVerdict", () => {
  it("drops frames the model says show no shared content", () => {
    expect(parseScreenshotVerdict(" NO_SHARED_CONTENT\n")).toEqual({
      kind: "no_shared_content",
    });
  });

  it("flattens and caps a description", () => {
    expect(parseScreenshotVerdict("A slide titled\n\"Q3 roadmap\".")).toEqual({
      kind: "described",
      description: 'A slide titled "Q3 roadmap".',
    });
    const long = parseScreenshotVerdict("x".repeat(900));
    expect(long.kind === "described" && long.description.length).toBe(400);
  });

  it("treats an empty reply as unavailable", () => {
    expect(parseScreenshotVerdict("  ")).toEqual({ kind: "unavailable" });
  });
});

describe("buildAudioNotesEnhancementPrompt with screenshots", () => {
  const base = { title: "Design review", rawNotes: "", transcript: "We looked at the new home screen." };

  it("lists screenshots in their own section before the raw notes", () => {
    const prompt = buildAudioNotesEnhancementPrompt({
      ...base,
      screenshots: [
        { offsetMs: 65_000, description: "Figma frame 'Home v3'", spokenNearby: null },
      ],
    });
    expect(prompt).toContain("# Shared-screen screenshots");
    expect(prompt).toContain("- [1:05] Figma frame 'Home v3'");
    expect(prompt.indexOf("# Shared-screen screenshots")).toBeLessThan(
      prompt.indexOf("# Raw notes")
    );
  });

  it("leaves the section out when there are none", () => {
    expect(buildAudioNotesEnhancementPrompt(base)).not.toContain(
      "# Shared-screen screenshots"
    );
  });
});

describe("POST /api/notes/:id/attachments (screenshots)", () => {
  function request(fields: Record<string, string>) {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "shot.jpg", { type: "image/jpeg" }));
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return new Request("https://loom.example/api/notes/note-1/attachments", {
      method: "POST",
      body: form,
    });
  }
  const params = { params: Promise.resolve({ id: "note-1" }) };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countNoteScreenshots.mockResolvedValue(0);
    mocks.createNoteAttachment.mockImplementation(async (row) => ({
      id: "att-1",
      createdAt: new Date("2026-11-22T00:00:00Z"),
      ...row,
    }));
  });

  it("stores a described screenshot with its offset", async () => {
    mocks.describeScreenshot.mockResolvedValue({ kind: "described", description: "Pricing slide" });
    const res = await POST(request({ kind: "screenshot", offsetMs: "42000" }), params);
    expect(res.status).toBe(201);
    const { attachment } = await res.json();
    expect(attachment).toMatchObject({
      kind: "screenshot",
      offsetMs: 42000,
      description: "Pricing slide",
    });
    expect(mocks.uploadBytes).toHaveBeenCalledOnce();
  });

  it("drops a frame with no shared content without storing it", async () => {
    mocks.describeScreenshot.mockResolvedValue({ kind: "no_shared_content" });
    const res = await POST(request({ kind: "screenshot", offsetMs: "42000" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ attachment: null, skipped: "no_shared_content" });
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
    expect(mocks.createNoteAttachment).not.toHaveBeenCalled();
  });

  it("keeps the frame undescribed when the model is unavailable", async () => {
    mocks.describeScreenshot.mockResolvedValue({ kind: "unavailable" });
    const res = await POST(request({ kind: "screenshot", offsetMs: "0" }), params);
    expect(res.status).toBe(201);
    expect((await res.json()).attachment.description).toBeNull();
  });

  it("refuses screenshots past the per-note limit", async () => {
    mocks.countNoteScreenshots.mockResolvedValue(60);
    const res = await POST(request({ kind: "screenshot", offsetMs: "0" }), params);
    expect(res.status).toBe(409);
    expect(mocks.describeScreenshot).not.toHaveBeenCalled();
  });

  it("leaves hand-attached images alone: no model call, kind image", async () => {
    const res = await POST(request({}), params);
    expect(res.status).toBe(201);
    expect(mocks.describeScreenshot).not.toHaveBeenCalled();
    expect(mocks.createNoteAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image", offsetMs: null, description: null })
    );
  });

  it("rejects a screenshot with a bad offset", async () => {
    const res = await POST(request({ kind: "screenshot", offsetMs: "soon" }), params);
    expect(res.status).toBe(400);
  });
});
