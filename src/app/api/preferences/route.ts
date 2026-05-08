import { NextResponse } from "next/server";
import {
  getUserPreferences,
  updateUserPreferences,
} from "@/db/queries/user-preferences";
import { requireAuth } from "@/lib/require-auth";
import { userPreferencesPatchSchema } from "@/lib/preferences/user-preferences";

export async function GET(request: Request) {
  const user = await requireAuth(request);
  const preferences = await getUserPreferences(user.id);
  return NextResponse.json({ preferences });
}

export async function PATCH(request: Request) {
  const user = await requireAuth(request);
  const json = await request.json().catch(() => ({}));
  const parsed = userPreferencesPatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_preferences" }, { status: 400 });
  }

  const preferences = await updateUserPreferences(user.id, parsed.data);
  return NextResponse.json({ preferences });
}
