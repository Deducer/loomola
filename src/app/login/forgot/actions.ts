"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function sendResetEmail(formData: FormData) {
  const email = (formData.get("email") as string | null)?.trim() ?? "";
  if (!email) return redirect("/login/forgot?error=Enter%20your%20email");

  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  // Always claim success — don't leak which emails have accounts.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/auth/callback?next=/auth/reset`,
  });
  return redirect("/login/forgot?sent=1");
}
