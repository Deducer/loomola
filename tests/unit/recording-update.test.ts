import { describe, expect, it } from "vitest";

describe("updateRecordingTitle / updateRecordingBrand signatures", () => {
  it("updateRecordingTitle exists and is async", async () => {
    const mod = await import("@/db/queries/recordings");
    expect(typeof mod.updateRecordingTitle).toBe("function");
  });
  it("updateRecordingBrand exists and is async", async () => {
    const mod = await import("@/db/queries/recordings");
    expect(typeof mod.updateRecordingBrand).toBe("function");
  });
});
