import { describe, it, expect } from "vitest";
import { generateSlug } from "@/lib/slug";

describe("generateSlug", () => {
  it("returns a 10-character string", () => {
    expect(generateSlug()).toHaveLength(10);
  });

  it("uses URL-safe alphanumerics only", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSlug()).toMatch(/^[0-9a-zA-Z_-]+$/);
    }
  });

  it("produces distinct slugs on repeated calls", () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) set.add(generateSlug());
    expect(set.size).toBe(100);
  });
});
