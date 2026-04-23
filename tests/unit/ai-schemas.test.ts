import { describe, it, expect } from "vitest";
import {
  titleSummarySchema,
  chaptersSchema,
  actionItemsSchema,
} from "@/lib/ai/schemas";

describe("titleSummarySchema", () => {
  it("accepts a valid object", () => {
    const r = titleSummarySchema.safeParse({
      title: "Product demo walkthrough",
      summary: "A 5-minute tour of the new dashboard features, focused on the recording pipeline and AI outputs.",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty title", () => {
    const r = titleSummarySchema.safeParse({ title: "", summary: "anything long enough to pass the min" });
    expect(r.success).toBe(false);
  });

  it("rejects a too-short summary", () => {
    const r = titleSummarySchema.safeParse({ title: "Ok title", summary: "short" });
    expect(r.success).toBe(false);
  });
});

describe("chaptersSchema", () => {
  it("accepts an empty array (single-topic recording)", () => {
    const r = chaptersSchema.safeParse({ chapters: [] });
    expect(r.success).toBe(true);
  });

  it("accepts valid chapters", () => {
    const r = chaptersSchema.safeParse({
      chapters: [
        { start_sec: 0, title: "Intro" },
        { start_sec: 45.5, title: "Main demo" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative timestamps", () => {
    const r = chaptersSchema.safeParse({
      chapters: [{ start_sec: -1, title: "Oops" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("actionItemsSchema", () => {
  it("accepts an empty array", () => {
    const r = actionItemsSchema.safeParse({ action_items: [] });
    expect(r.success).toBe(true);
  });

  it("accepts valid items", () => {
    const r = actionItemsSchema.safeParse({
      action_items: [
        { text: "Ship the recording pipeline by Friday.", timestamp_sec: 120 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects too-short text", () => {
    const r = actionItemsSchema.safeParse({
      action_items: [{ text: "hi", timestamp_sec: 0 }],
    });
    expect(r.success).toBe(false);
  });
});
