"use server";

import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { hasAnyUser } from "@/lib/auth/first-run";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseService } from "@/lib/supabase/service";
import { redirect } from "next/navigation";

export async function createAdminAccount(formData: FormData) {
  // Re-check inside the action: the page-level check is advisory only.
  if (await hasAnyUser()) {
    return redirect("/login?error=Setup%20is%20already%20complete");
  }

  const email = (formData.get("email") as string | null)?.trim() ?? "";
  const password = (formData.get("password") as string | null) ?? "";
  if (!email || !email.includes("@")) {
    return redirect("/setup?error=Enter%20a%20valid%20email");
  }
  if (password.length < 8) {
    return redirect("/setup?error=Password%20must%20be%20at%20least%208%20characters");
  }

  const service = getSupabaseService();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    return redirect(
      `/setup?error=${encodeURIComponent(error?.message ?? "Could not create account")}`
    );
  }

  await db
    .insert(userPreferences)
    .values({ ownerId: data.user.id, role: "admin" })
    .onConflictDoUpdate({
      target: userPreferences.ownerId,
      set: { role: "admin" },
    });

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email, password });
  return redirect("/");
}
