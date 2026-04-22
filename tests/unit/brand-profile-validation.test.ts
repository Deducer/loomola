import { describe, it, expect } from "vitest";
import { brandProfileInputSchema } from "@/lib/validation/brand-profile";

describe("brandProfileInputSchema", () => {
  it("accepts a valid profile", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Vayu Labs",
      accentColor: "#FF6B35",
      logoUrl: "https://vayulabs.com/logo.png",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid profile without a logo URL", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Personal",
      accentColor: "#4F46E5",
    });
    expect(result.success).toBe(true);
  });

  it("treats an empty string logoUrl as undefined", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Personal",
      accentColor: "#4F46E5",
      logoUrl: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logoUrl).toBeUndefined();
    }
  });

  it("rejects an empty name", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "",
      accentColor: "#FF6B35",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid hex color", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Vayu Labs",
      accentColor: "orange",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a hex color missing the #", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Vayu Labs",
      accentColor: "FF6B35",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed logo URL", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Vayu Labs",
      accentColor: "#FF6B35",
      logoUrl: "not a url",
    });
    expect(result.success).toBe(false);
  });
});
