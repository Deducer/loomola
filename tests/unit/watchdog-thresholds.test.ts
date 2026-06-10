// tests/unit/watchdog-thresholds.test.ts
import { describe, expect, it } from "vitest";
import { STUCK_THRESHOLDS, stuckReasonFor } from "@/lib/queue/jobs/watchdog";

const NOW = new Date("2026-06-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("stuckReasonFor", () => {
  it("transcribing is stuck after 2 hours, not before", () => {
    expect(stuckReasonFor("transcribing", hoursAgo(1.9), NOW)).toBeNull();
    expect(stuckReasonFor("transcribing", hoursAgo(2.1), NOW)).toMatch(/Transcription/);
  });

  it("processing is stuck after 1 hour, not before", () => {
    expect(stuckReasonFor("processing", hoursAgo(0.9), NOW)).toBeNull();
    expect(stuckReasonFor("processing", hoursAgo(1.1), NOW)).toMatch(/AI processing/);
  });

  it("uploading is stuck after 24 hours, not before", () => {
    expect(stuckReasonFor("uploading", hoursAgo(23), NOW)).toBeNull();
    expect(stuckReasonFor("uploading", hoursAgo(25), NOW)).toMatch(/Upload/);
  });

  it("terminal states are never stuck", () => {
    expect(stuckReasonFor("ready", hoursAgo(9999), NOW)).toBeNull();
    expect(stuckReasonFor("failed", hoursAgo(9999), NOW)).toBeNull();
  });

  it("threshold table covers exactly the three non-terminal states", () => {
    expect(STUCK_THRESHOLDS.map((t) => t.status).sort()).toEqual([
      "processing",
      "transcribing",
      "uploading",
    ]);
  });
});
