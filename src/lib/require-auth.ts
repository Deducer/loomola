import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

type AuthClaims = {
  sub?: unknown;
  aud?: unknown;
  role?: unknown;
  email?: unknown;
  phone?: unknown;
  app_metadata?: unknown;
  user_metadata?: unknown;
};

let bearerAuthClient: ReturnType<typeof createSupabaseClient> | null = null;

function getBearerAuthClient() {
  bearerAuthClient ??= createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return bearerAuthClient;
}

export function bearerTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function userFromClaims(claims: AuthClaims | null | undefined): User | null {
  if (!claims || typeof claims.sub !== "string") return null;
  const id = claims.sub;
  return {
    id,
    aud: typeof claims.aud === "string" ? claims.aud : "authenticated",
    role: typeof claims.role === "string" ? claims.role : undefined,
    email: typeof claims.email === "string" ? claims.email : undefined,
    phone: typeof claims.phone === "string" ? claims.phone : undefined,
    app_metadata:
      claims.app_metadata && typeof claims.app_metadata === "object"
        ? claims.app_metadata
        : {},
    user_metadata:
      claims.user_metadata && typeof claims.user_metadata === "object"
        ? claims.user_metadata
        : {},
    identities: [],
    created_at: "",
  } as User;
}

async function getBearerUser(request: Request): Promise<User | null> {
  const token = bearerTokenFromRequest(request);
  if (!token) return null;

  const { data, error } = await getBearerAuthClient().auth.getClaims(token);
  if (error || !data?.claims) return null;
  return userFromClaims(data.claims);
}

export async function getOptionalAuthUser(request?: Request): Promise<User | null> {
  if (request) {
    const bearerUser = await getBearerUser(request);
    if (bearerUser) return bearerUser;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return userFromClaims(data.claims);
}

/**
 * Retrieves the currently authenticated user, or redirects to /login.
 * Use in server pages and server actions that require auth. API routes can
 * pass the Request to allow native clients to authenticate with a Supabase
 * bearer token instead of browser cookies.
 */
export async function requireAuth(request?: Request): Promise<User> {
  const user = await getOptionalAuthUser(request);
  if (!user) redirect("/login");
  return user;
}
