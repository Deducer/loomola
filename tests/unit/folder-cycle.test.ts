import { describe, it, expect } from "vitest";
import { wouldCreateCycle } from "@/lib/folders/cycle";

type Node = { id: string; parentId: string | null };

describe("wouldCreateCycle", () => {
  const folders: Node[] = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: null },
  ];

  it("rejects moving a folder into itself", () => {
    expect(wouldCreateCycle(folders, "a", "a")).toBe(true);
  });

  it("rejects moving a folder into its descendant", () => {
    expect(wouldCreateCycle(folders, "a", "b")).toBe(true);
    expect(wouldCreateCycle(folders, "a", "c")).toBe(true);
  });

  it("allows moving a folder to an unrelated parent", () => {
    expect(wouldCreateCycle(folders, "c", "d")).toBe(false);
    expect(wouldCreateCycle(folders, "b", "d")).toBe(false);
  });

  it("allows moving to root (null parent)", () => {
    expect(wouldCreateCycle(folders, "c", null)).toBe(false);
  });

  it("allows moving a sibling into another sibling", () => {
    expect(wouldCreateCycle(folders, "d", "a")).toBe(false);
  });
});
