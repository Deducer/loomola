import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { updateRecordingBrand } from "@/db/queries/recordings";

const brandSchema = z.object({
  brandProfileId: z.string().uuid().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = brandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_brand" }, { status: 400 });
  }
  const ok = await updateRecordingBrand({
    id,
    ownerId: user.id,
    brandProfileId: parsed.data.brandProfileId,
  });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
