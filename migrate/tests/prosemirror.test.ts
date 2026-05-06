import { describe, expect, it } from "bun:test";
import { proseMirrorJsonToMarkdown } from "../src/transform/prosemirror";

describe("proseMirrorJsonToMarkdown", () => {
  it("converts a minimal paragraph", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    };
    expect(proseMirrorJsonToMarkdown(doc)).toBe("Hello world");
  });

  it("converts headings + bullets", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Agenda" }],
        },
        {
          type: "bullet_list",
          content: [
            {
              type: "list_item",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "thing 1" }],
                },
              ],
            },
            {
              type: "list_item",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "thing 2" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = proseMirrorJsonToMarkdown(doc);
    expect(md).toContain("## Agenda");
    expect(md).toContain("thing 1");
    expect(md).toContain("thing 2");
  });

  it("returns empty string for empty doc", () => {
    expect(proseMirrorJsonToMarkdown({ type: "doc", content: [] })).toBe("");
  });

  it("returns empty string for null/garbage", () => {
    expect(proseMirrorJsonToMarkdown(null)).toBe("");
    expect(proseMirrorJsonToMarkdown({})).toBe("");
    expect(proseMirrorJsonToMarkdown(undefined)).toBe("");
    expect(proseMirrorJsonToMarkdown("not an object")).toBe("");
  });

  it("flattens unknown block types to plain text without throwing", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "granola_poll",
          content: [{ type: "text", text: "Question?" }],
        },
      ],
    };
    expect(() => proseMirrorJsonToMarkdown(doc)).not.toThrow();
    expect(proseMirrorJsonToMarkdown(doc)).toContain("Question");
  });

  it("handles preserved bold/italic marks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            {
              type: "text",
              marks: [{ type: "strong" }],
              text: "bold",
            },
            { type: "text", text: " " },
            {
              type: "text",
              marks: [{ type: "em" }],
              text: "italic",
            },
          ],
        },
      ],
    };
    const md = proseMirrorJsonToMarkdown(doc);
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
  });
});
