"use server";

import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { getInviteByTokenHash, markInviteAccepted } from "@/db/queries/invites";
import { hashInviteToken, validateInvite } from "@/lib/invites/token";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseService } from "@/lib/supabase/service";
import { redirect } from "next/navigation";

export async function acceptInvite(token: string, formData: FormData) {
  const invite = await getInviteByTokenHash(hashInviteToken(token));
  const validation = validateInvite(invite, new Date());
  if (!validation.ok) {
    return redirect(`/setup/accept/${token}?error=${validation.reason}`);
  }

  const password = (formData.get("password") as string | null) ?? "";
  if (password.length < 8) {
    return redirect(
      `/setup/accept/${token}?error=Password%20must%20be%20at%20least%208%20characters`
    );
  }

  const service = getSupabaseService();
  const { data, error } = await service.auth.admin.createUser({
    email: invite!.email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    const msg = error?.message?.includes("already")
      ? "An account with this email already exists — sign in instead"
      : (error?.message ?? "Could not create account");
    return redirect(`/setup/accept/${token}?error=${encodeURIComponent(msg)}`);
  }

  await db
    .insert(userPreferences)
    .values({ ownerId: data.user.id, role: "member" })
    .onConflictDoNothing();
  await markInviteAccepted(invite!.id);

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email: invite!.email, password });
  return redirect("/");
}
