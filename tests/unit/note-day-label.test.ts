import { describe, expect, it } from "vitest";
import { noteDayLabel } from "@/components/dashboard/notes-list";

describe("noteDayLabel", () => {
  it("labels today's notes", () => {
    expect(
      noteDayLabel(new Date("2026-05-01T09:00:00"), new Date("2026-05-01T18:00:00"))
    ).toBe("Today");
  });

  it("labels yesterday's notes", () => {
    expect(
      noteDayLabel(new Date("2026-04-30T09:00:00"), new Date("2026-05-01T18:00:00"))
    ).toBe("Yesterday");
  });
});
