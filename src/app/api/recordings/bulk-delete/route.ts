import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { softDeleteRecordings } from "@/db/queries/recordings";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(request: Request) {
  const user = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_ids" }, { status: 400 });
  }

  const count = await softDeleteRecordings(parsed.data.ids, user.id);
  return NextResponse.json({ ok: true, count });
}
