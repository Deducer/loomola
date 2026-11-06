import { describe, expect, it } from "vitest";
import { normalizeIdOrSlug, pickBrand } from "@/app/api/mcp/tools/lookup";
import { mimeForFilename, planParts } from "@/app/api/mcp/tools/upload";

const brands = [
  { id: "e4db6d59-97bb-425f-a538-5fe3d4cce730", name: "CMA Studio" },
  { id: "11111111-1111-4111-8111-111111111111", name: "Vayu Labs" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Vayu Labs Dark" },
];

describe("pickBrand", () => {
  it("matches by id", () => {
    expect(pickBrand(brands, "E4DB6D59-97BB-425F-A538-5FE3D4CCE730")).toMatchObject({
      ok: true,
      brand: { name: "CMA Studio" },
    });
  });
  it("matches an exact name case-insensitively even when it is also a fragment", () => {
    expect(pickBrand(brands, "vayu labs")).toMatchObject({ ok: true, brand: { name: "Vayu Labs" } });
  });
  it("matches a unique fragment", () => {
    expect(pickBrand(brands, "cma")).toMatchObject({ ok: true, brand: { name: "CMA Studio" } });
  });
  it("refuses to guess between several fragments", () => {
    const pick = pickBrand(brands, "vayu");
    expect(pick).toMatchObject({ ok: false, reason: "ambiguous" });
    if (!pick.ok) expect(pick.candidates).toHaveLength(2);
  });
  it("reports not found with every brand as a candidate", () => {
    expect(pickBrand(brands, "acme")).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("normalizeIdOrSlug", () => {
  it("pulls the slug out of share and note URLs", () => {
    expect(normalizeIdOrSlug("https://loom.example.com/v/4nbj5vZbAg")).toBe("4nbj5vZbAg");
    expect(normalizeIdOrSlug("https://loom.example.com/notes/abc_123?x=1")).toBe("abc_123");
  });
  it("pulls the id out of an edit URL", () => {
    expect(
      normalizeIdOrSlug("https://loom.example.com/recordings/e4db6d59-97bb-425f-a538-5fe3d4cce730/edit")
    ).toBe("e4db6d59-97bb-425f-a538-5fe3d4cce730");
  });
  it("passes bare ids and slugs through", () => {
    expect(normalizeIdOrSlug("  qjGNRMcdF4 ")).toBe("qjGNRMcdF4");
  });
});

describe("upload planning", () => {
  it("uses 8 MiB parts for ordinary files", () => {
    expect(planParts(20 * 1024 * 1024)).toEqual({ partSize: 8 * 1024 * 1024, partCount: 3 });
    expect(planParts(1)).toEqual({ partSize: 8 * 1024 * 1024, partCount: 1 });
  });
  it("grows the part size so huge files stay at or under 1000 parts", () => {
    const size = 15 * 1024 * 1024 * 1024;
    const plan = planParts(size);
    expect(plan.partCount).toBeLessThanOrEqual(1000);
    expect(plan.partSize % (1024 * 1024)).toBe(0);
    expect(plan.partSize * plan.partCount).toBeGreaterThanOrEqual(size);
  });
  it("maps video extensions to upload mime types", () => {
    expect(mimeForFilename("Clip.MOV")).toBe("video/mp4");
    expect(mimeForFilename("a/b/c.webm")).toBe("video/webm");
    expect(mimeForFilename("notes.txt")).toBeNull();
  });
});
