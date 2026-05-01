import { describe, expect, it } from "vitest";
import { isUuidIdentifier } from "@/db/queries/notes";

describe("note identifiers", () => {
  it("recognizes UUID media IDs", () => {
    expect(isUuidIdentifier("c1bdc464-f2bf-452f-9fe0-9ee0dc2614d0")).toBe(true);
  });

  it("treats desktop slugs as non-UUID identifiers", () => {
    expect(isUuidIdentifier("ZTrwDqeOop")).toBe(false);
  });

  it("rejects malformed UUID-like strings", () => {
    expect(isUuidIdentifier("not-a-real-uuid")).toBe(false);
    expect(isUuidIdentifier("c1bdc464-f2bf-452f-9fe0")).toBe(false);
  });
});
