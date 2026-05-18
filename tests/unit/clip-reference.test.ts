import { describe, expect, it } from "vitest";
import { parseClipReference } from "@/lib/recordings/clip-reference";

describe("parseClipReference", () => {
  it("accepts raw recording UUIDs", () => {
    expect(
      parseClipReference("11111111-2222-4333-8444-555555555555")
    ).toEqual({
      kind: "id",
      value: "11111111-2222-4333-8444-555555555555",
    });
  });

  it("accepts raw share slugs", () => {
    expect(parseClipReference("abcDEF_123")).toEqual({
      kind: "slug",
      value: "abcDEF_123",
    });
  });

  it("extracts slugs from share URLs with query params", () => {
    expect(
      parseClipReference("https://loom.dissonance.cloud/v/a214c041?login_source=modal")
    ).toEqual({
      kind: "slug",
      value: "a214c041",
    });
  });

  it("extracts ids from edit URLs", () => {
    expect(
      parseClipReference(
        "https://loom.dissonance.cloud/recordings/11111111-2222-4333-8444-555555555555/edit"
      )
    ).toEqual({
      kind: "id",
      value: "11111111-2222-4333-8444-555555555555",
    });
  });

  it("returns null for ordinary search text", () => {
    expect(parseClipReference("logo upload clarification")).toBeNull();
  });
});
