import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  formatBytes,
  pickDroppedVideo,
  titleFromFileName,
  validateVideoFile,
} from "@/lib/upload/validate-video-file";

const mp4 = { name: "fire-island-phase1.mp4", size: 15_895_303, type: "video/mp4" };

describe("validateVideoFile", () => {
  it("accepts an mp4 and derives the title from the file name", () => {
    expect(validateVideoFile(mp4)).toEqual({
      ok: true,
      mimeType: "video/mp4",
      title: "fire-island-phase1",
    });
  });

  it("maps mov and m4v to video/mp4 even when the browser type is empty", () => {
    expect(validateVideoFile({ name: "Clip.MOV", size: 10, type: "" })).toMatchObject({
      ok: true,
      mimeType: "video/mp4",
      title: "Clip",
    });
    expect(validateVideoFile({ name: "a.m4v", size: 10, type: "video/x-m4v" })).toMatchObject({
      ok: true,
      mimeType: "video/mp4",
    });
  });

  it("accepts webm", () => {
    expect(validateVideoFile({ name: "rec.webm", size: 10, type: "video/webm;codecs=vp9" })).toMatchObject({
      ok: true,
      mimeType: "video/webm",
    });
  });

  it("falls back to the browser MIME type when the extension is unknown", () => {
    expect(validateVideoFile({ name: "download", size: 10, type: "video/mp4" })).toMatchObject({
      ok: true,
      mimeType: "video/mp4",
      title: "download",
    });
  });

  it("rejects non-video files", () => {
    const r = validateVideoFile({ name: "notes.pdf", size: 10, type: "application/pdf" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/MP4, MOV, M4V or WebM/);
  });

  it("rejects mkv and avi, which the pipeline cannot key", () => {
    expect(validateVideoFile({ name: "x.mkv", size: 10, type: "video/x-matroska" }).ok).toBe(false);
    expect(validateVideoFile({ name: "x.avi", size: 10, type: "video/avi" }).ok).toBe(false);
  });

  it("rejects empty files", () => {
    expect(validateVideoFile({ ...mp4, size: 0 })).toEqual({
      ok: false,
      reason: "That file is empty.",
    });
  });

  it("rejects files over 2 GB but accepts exactly 2 GB", () => {
    expect(validateVideoFile({ ...mp4, size: MAX_UPLOAD_BYTES })).toMatchObject({ ok: true });
    expect(validateVideoFile({ ...mp4, size: MAX_UPLOAD_BYTES + 1 })).toEqual({
      ok: false,
      reason: "Videos must be 2 GB or smaller.",
    });
  });
});

describe("pickDroppedVideo", () => {
  it("rejects an empty drop and multi-file drops", () => {
    expect(pickDroppedVideo([])).toEqual({ ok: false, reason: "Drop a video file." });
    expect(pickDroppedVideo([mp4, mp4])).toEqual({ ok: false, reason: "Drop one video at a time." });
  });

  it("validates a single dropped file", () => {
    expect(pickDroppedVideo([mp4])).toMatchObject({ ok: true, mimeType: "video/mp4" });
  });
});

describe("titleFromFileName", () => {
  it("strips the extension and trims", () => {
    expect(titleFromFileName("  Status update.mp4 ")).toBe("Status update");
  });
  it("keeps dotfiles and names without extensions", () => {
    expect(titleFromFileName(".hidden")).toBe(".hidden");
    expect(titleFromFileName("plain")).toBe("plain");
  });
  it("falls back to Untitled", () => {
    expect(titleFromFileName(".mp4")).toBe(".mp4");
    expect(titleFromFileName("   ")).toBe("Untitled");
  });
});

describe("formatBytes", () => {
  it("formats KB, MB and GB", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(15_895_303)).toBe("15.2 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.00 GB");
  });
});
