import { describe, expect, it } from "vitest";
import {
  compositeEditKey,
  extensionForKey,
  playbackKeyForComposite,
  previewSpriteKeyForComposite,
  thumbnailKeyForComposite,
} from "@/lib/recordings/artifact-keys";

describe("recording artifact keys", () => {
  it("keeps derived artifacts under the composite object's prefix", () => {
    expect(thumbnailKeyForComposite("rec-1/composite.webm")).toBe(
      "rec-1/thumbnail.jpg"
    );
    expect(previewSpriteKeyForComposite("rec-1/edits/composite-1.mp4")).toBe(
      "rec-1/edits/preview-sprite.jpg"
    );
    expect(playbackKeyForComposite("rec-1/edits/composite-1.mp4")).toBe(
      "rec-1/edits/playback.mp4"
    );
  });

  it("creates timestamped MP4 composite edit keys", () => {
    expect(
      compositeEditKey("rec-1/composite.webm", new Date("2026-05-18T16:00:00Z"))
    ).toBe("rec-1/edits/composite-1779120000000.mp4");
  });

  it("reads download extensions from object keys", () => {
    expect(extensionForKey("rec-1/composite.webm", "webm")).toBe("webm");
    expect(extensionForKey("rec-1/edits/composite-1.mp4", "webm")).toBe("mp4");
    expect(extensionForKey("rec-1/raw", "webm")).toBe("webm");
  });
});
