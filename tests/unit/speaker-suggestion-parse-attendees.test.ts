import { describe, it, expect } from "vitest";
import { parseAttendees } from "@/lib/speaker-suggestion/parse-attendees";

describe("parseAttendees", () => {
  it("returns [] for null/undefined/empty", () => {
    expect(parseAttendees(null)).toEqual([]);
    expect(parseAttendees(undefined)).toEqual([]);
    expect(parseAttendees([])).toEqual([]);
  });

  it("returns [] for non-array input", () => {
    expect(parseAttendees("not an array")).toEqual([]);
    expect(parseAttendees(42)).toEqual([]);
    expect(parseAttendees({ name: "x" })).toEqual([]);
  });

  it("parses array of strings as display names", () => {
    expect(parseAttendees(["Sarah Chen", "Alex Park"])).toEqual([
      { displayName: "Sarah Chen", email: null },
      { displayName: "Alex Park", email: null },
    ]);
  });

  it("parses array of objects with name/email", () => {
    expect(
      parseAttendees([
        { name: "Sarah Chen", email: "sarah@example.com" },
        { name: "Alex Park", email: "alex@example.com" },
      ])
    ).toEqual([
      { displayName: "Sarah Chen", email: "sarah@example.com" },
      { displayName: "Alex Park", email: "alex@example.com" },
    ]);
  });

  it("supports displayName as an alternate key", () => {
    expect(
      parseAttendees([{ displayName: "Sarah Chen", email: "sarah@x.com" }])
    ).toEqual([{ displayName: "Sarah Chen", email: "sarah@x.com" }]);
  });

  it("normalizes emails to lowercase + trims whitespace", () => {
    expect(
      parseAttendees([{ name: "  Sarah  ", email: " Sarah@Example.COM " }])
    ).toEqual([{ displayName: "Sarah", email: "sarah@example.com" }]);
  });

  it("filters out entries with neither name nor email", () => {
    expect(
      parseAttendees([
        { name: "Sarah" },
        {},
        "  ",
        { name: "", email: "" },
        { name: "Alex" },
      ])
    ).toEqual([
      { displayName: "Sarah", email: null },
      { displayName: "Alex", email: null },
    ]);
  });

  it("handles entries with only an email (no name)", () => {
    expect(parseAttendees([{ email: "noname@example.com" }])).toEqual([
      { displayName: null, email: "noname@example.com" },
    ]);
  });

  it("preserves order", () => {
    const result = parseAttendees(["Charlie", "Bob", "Alice"]);
    expect(result.map((a) => a.displayName)).toEqual([
      "Charlie",
      "Bob",
      "Alice",
    ]);
  });

  it("dedupes by lowercased email when present", () => {
    const result = parseAttendees([
      { name: "Sarah", email: "sarah@x.com" },
      { name: "Sarah Chen", email: "Sarah@X.com" },
      { name: "Alex", email: "alex@x.com" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].email).toBe("sarah@x.com");
    expect(result[1].email).toBe("alex@x.com");
  });
});
