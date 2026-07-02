import { describe, expect, it } from "vitest";
import { normalizeCalendarAttendees } from "@/lib/people/resolve-attendees";

describe("normalizeCalendarAttendees", () => {
  it("trims and lowercases emails", () => {
    const out = normalizeCalendarAttendees([
      { displayName: "  Jack Roberts  ", email: " Jack@Example.COM " },
    ]);
    expect(out).toEqual([
      { displayName: "Jack Roberts", email: "jack@example.com" },
    ]);
  });

  it("dedupes by email regardless of name spelling", () => {
    const out = normalizeCalendarAttendees([
      { displayName: "Jack Roberts", email: "jack@example.com" },
      { displayName: "J. Roberts", email: "JACK@example.com" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("dedupes email-less entries by case-insensitive name", () => {
    const out = normalizeCalendarAttendees([
      { displayName: "Jack Roberts" },
      { displayName: "jack roberts" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("derives a name from the email local part when the name is blank", () => {
    const out = normalizeCalendarAttendees([
      { displayName: "", email: "maria.chen@example.com" },
    ]);
    expect(out).toEqual([
      { displayName: "maria.chen", email: "maria.chen@example.com" },
    ]);
  });

  it("drops entries with neither name nor email", () => {
    expect(
      normalizeCalendarAttendees([{ displayName: "  " }, { displayName: "" }])
    ).toEqual([]);
  });

  it("preserves order", () => {
    const out = normalizeCalendarAttendees([
      { displayName: "B", email: "b@x.com" },
      { displayName: "A", email: "a@x.com" },
    ]);
    expect(out.map((a) => a.displayName)).toEqual(["B", "A"]);
  });
});
