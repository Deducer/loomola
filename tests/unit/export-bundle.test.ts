import { describe, expect, it } from "vitest";
import {
  buildBundleMarkdown,
  bundleEntryPath,
} from "@/lib/export/bundle-markdown";
import type { ExportBundleMediaData } from "@/db/queries/export-bundle";

describe("bulk export markdown", () => {
  it("builds a useful audio-note markdown file", () => {
    const item = baseItem("audio");
    const markdown = buildBundleMarkdown(item, "https://loom.dissonance.cloud");

    expect(markdown).toContain('meeting_id: "media-1"');
    expect(markdown).toContain('type: "audio"');
    expect(markdown).toContain("## Notes");
    expect(markdown).toContain("Raw typed notes.");
    expect(markdown).toContain("- [ ] Follow up with Omar (0:12)");
    expect(markdown).toContain("https://loom.dissonance.cloud/notes/export-test");
    expect(bundleEntryPath(item)).toBe("audio/2026-05-01-export-test.md");
  });

  it("uses the share URL for video recordings", () => {
    const markdown = buildBundleMarkdown(
      baseItem("video"),
      "https://loom.dissonance.cloud"
    );

    expect(markdown).toContain('type: "video"');
    expect(markdown).toContain("https://loom.dissonance.cloud/v/export-test");
    expect(markdown).not.toContain("## Notes");
  });
});

function baseItem(type: "audio" | "video"): ExportBundleMediaData {
  return {
    media: {
      id: "media-1",
      ownerId: "owner-1",
      type,
      slug: "export-test",
      title: "Export Test",
      description: null,
      status: "ready",
      brandProfileId: null,
      durationSeconds: "49",
      r2CompositeKey: null,
      playbackMp4Key: null,
      r2ScreenKey: null,
      r2CameraKey: null,
      r2MicKey: null,
      r2SystemaudioKey: null,
      compositeThumbnailKey: null,
      previewSpriteKey: null,
      trimStartSec: null,
      trimEndSec: null,
      passwordHash: null,
      uploadMetadata: null,
      folderId: null,
      searchTsv: null,
      meetingDetectedApp: null,
      meetingStartedAtLocal: null,
      attendees: null,
      r2MixedKey: null,
      obsidianSaveRequestedAt: null,
      obsidianSyncedAt: null,
      sourceContextHint: null,
      createdAt: new Date("2026-05-01T20:08:00.000Z"),
      updatedAt: new Date("2026-05-01T20:09:00.000Z"),
      deletedAt: null,
    },
    brandProfile: null,
    note:
      type === "audio"
        ? {
            id: "note-1",
            mediaObjectId: "media-1",
            ownerId: "owner-1",
            body: "Raw typed notes.",
            createdAt: new Date("2026-05-01T20:08:00.000Z"),
            updatedAt: new Date("2026-05-01T20:09:00.000Z"),
          }
        : null,
    transcript: {
      id: "transcript-1",
      mediaObjectId: "media-1",
      deepgramRequestId: null,
      language: "en",
      fullText: "We should ship the export flow.",
      wordTimestamps: [],
      searchTsv: null,
      provider: "deepgram",
      providerRequestId: null,
      createdAt: new Date("2026-05-01T20:08:00.000Z"),
    },
    aiOutput: {
      id: "ai-1",
      mediaObjectId: "media-1",
      titleSuggested: "Export Test",
      summary: "## Overview\n\nA test export.",
      chapters: [{ start_sec: 0, title: "Opening" }],
      actionItems: [{ text: "Follow up with Omar", timestamp_sec: 12 }],
      llmModel: "test",
      searchTsv: null,
      templateId: "default",
      generationStatusValue: "complete",
      generatedAt: new Date("2026-05-01T20:10:00.000Z"),
    },
  };
}
