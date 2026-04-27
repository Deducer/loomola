import { describe, expect, it } from "vitest";
import { bearerTokenFromRequest } from "@/lib/require-auth";
import { extensionForMime, keyForTrack } from "@/lib/recording/upload-keys";

describe("desktop API compatibility", () => {
  it("extracts Supabase bearer tokens from native-client requests", () => {
    const req = new Request("https://loom.dissonance.cloud/api/recordings/start", {
      headers: { authorization: "Bearer desktop-token" },
    });

    expect(bearerTokenFromRequest(req)).toBe("desktop-token");
  });

  it("ignores non-bearer authorization headers", () => {
    const req = new Request("https://loom.dissonance.cloud/api/recordings/start", {
      headers: { authorization: "Basic desktop-token" },
    });

    expect(bearerTokenFromRequest(req)).toBeNull();
  });

  it("keeps browser WebM upload keys unchanged", () => {
    expect(keyForTrack("abc123", "composite", "video/webm;codecs=vp9,opus")).toBe(
      "abc123/composite.webm"
    );
    expect(keyForTrack("abc123", "mic", "audio/webm;codecs=opus")).toBe(
      "abc123/raw/mic.webm"
    );
  });

  it("uses native macOS MP4/M4A upload keys for desktop MIME types", () => {
    expect(extensionForMime("video/mp4")).toBe("mp4");
    expect(extensionForMime("audio/mp4")).toBe("m4a");
    expect(keyForTrack("abc123", "screen", "video/mp4")).toBe(
      "abc123/raw/screen.mp4"
    );
    expect(keyForTrack("abc123", "system-audio", "audio/mp4")).toBe(
      "abc123/raw/system-audio.m4a"
    );
  });
});
