import { NextResponse } from "next/server";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { z } from "zod";
import {
  listNoteTemplatesForOwner,
  upsertUserNoteTemplate,
} from "@/db/queries/note-templates";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);

  return NextResponse.json({
    templates: await listNoteTemplatesForOwner(user.id),
  });
}

const sectionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(1000),
});

const createTemplateSchema = z.object({
  // Optional explicit id (slug) — used by migrations of pre-existing
  // templates so notes referencing the old id keep resolving. Defaults
  // to a slug of the name.
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,80}$/).optional(),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).optional(),
  description: z.string().trim().max(300).optional(),
  meetingContext: z.string().trim().min(1).max(4000),
  sections: z.array(sectionSchema).max(12),
});

/// Create or update one of the caller's own templates (upsert by id).
/// Built-in ids can be shadowed deliberately — a user override wins.
export async function POST(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const json = await request.json().catch(() => ({}));
  const parsed = createTemplateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_template" }, { status: 400 });
  }
  const id =
    parsed.data.id ??
    parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  if (!id) {
    return NextResponse.json({ error: "invalid_template" }, { status: 400 });
  }
  const template = await upsertUserNoteTemplate({
    ownerId: user.id,
    id,
    name: parsed.data.name,
    category: parsed.data.category,
    description: parsed.data.description,
    meetingContext: parsed.data.meetingContext,
    sections: parsed.data.sections,
  });
  return NextResponse.json({ template }, { status: 201 });
}
