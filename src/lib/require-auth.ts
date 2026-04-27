import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

export function bearerTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function getBearerUser(request: Request): Promise<User | null> {
  const token = bearerTokenFromRequest(request);
  if (!token) return null;

  const supabase = createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

/**
 * Retrieves the currently authenticated user, or redirects to /login.
 * Use in server pages and server actions that require auth. API routes can
 * pass the Request to allow native clients to authenticate with a Supabase
 * bearer token instead of browser cookies.
 */
export async function requireAuth(request?: Request): Promise<User> {
  if (request) {
    const bearerUser = await getBearerUser(request);
    if (bearerUser) return bearerUser;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}
