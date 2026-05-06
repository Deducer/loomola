// Convert Granola's ProseMirror JSON note bodies to Markdown.
//
// Granola stores notes as ProseMirror JSON. Loomola's notes.body is
// plain Markdown. The CLI does this conversion before POSTing — the
// server never has to know about ProseMirror.
//
// Granola may include block types not in the default ProseMirror
// schema (template-specific blocks like polls, decisions). We extend
// the default schema with a permissive "granola_unknown" block so
// unknown types don't crash the serializer; their text content
// flattens to plain text.
//
// Spec: docs/superpowers/specs/2026-05-06-granola-migration-tool-design.md

import {
  defaultMarkdownSerializer,
  schema as basicSchema,
} from "prosemirror-markdown";
import { Schema } from "prosemirror-model";

const granolaSchema = new Schema({
  nodes: basicSchema.spec.nodes.append({
    granola_unknown: {
      group: "block",
      content: "(text|inline)*",
      toDOM: () => ["div", 0],
      parseDOM: [{ tag: "div.granola-unknown" }],
    },
  }),
  marks: basicSchema.spec.marks,
});

// Add a passthrough serializer for the granola_unknown block so the
// default markdown serializer doesn't choke on it. Just emits its text.
const granolaSerializer = new (defaultMarkdownSerializer as any).constructor(
  {
    ...defaultMarkdownSerializer.nodes,
    granola_unknown(state: any, node: any) {
      state.renderInline(node);
      state.closeBlock(node);
    },
  },
  defaultMarkdownSerializer.marks
);

export function proseMirrorJsonToMarkdown(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as { type?: string; content?: unknown[] };
  if (obj.type !== "doc" || !Array.isArray(obj.content)) return "";
  const coerced = coerceUnknownNodes(obj, granolaSchema);
  try {
    const node = granolaSchema.nodeFromJSON(coerced);
    return granolaSerializer.serialize(node).trim();
  } catch {
    return extractTextOnly(coerced).trim();
  }
}

function coerceUnknownNodes(node: any, schema: Schema): any {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => coerceUnknownNodes(n, schema));
  const out: any = { ...node };
  if (typeof out.type === "string" && !schema.nodes[out.type]) {
    out.type = "granola_unknown";
  }
  if (Array.isArray(out.content)) {
    out.content = out.content.map((c: unknown) =>
      coerceUnknownNodes(c, schema)
    );
  }
  return out;
}

function extractTextOnly(node: any): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(extractTextOnly).filter(Boolean).join(" ");
  }
  return "";
}
