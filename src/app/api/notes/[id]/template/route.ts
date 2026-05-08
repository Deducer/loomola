import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertNoteTemplate } from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { isSystemNoteTemplateId } from "@/lib/ai/note-templates";

const templateSchema = z.object({
  templateId: z.string().min(1),
});

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;

  const json = await request.json().catch(() => ({}));
  const parsed = templateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "template_required" }, { status: 400 });
  }
  if (!isSystemNoteTemplateId(parsed.data.templateId)) {
    return NextResponse.json({ error: "unknown_template" }, { status: 400 });
  }

  try {
    const row = await upsertNoteTemplate(id, user.id, parsed.data.templateId);
    return NextResponse.json(
      { templateId: row.templateId, body: row.body },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "media_object_not_found" },
      { status: 404 }
    );
  }
}
