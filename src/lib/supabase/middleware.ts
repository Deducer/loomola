import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();
  const isAuthRoute = url.pathname.startsWith("/login") ||
                      url.pathname.startsWith("/auth");
  const isApiHealth = url.pathname === "/api/health";
  const isPublicShare = url.pathname.startsWith("/v/");
  const isWebhook = url.pathname.startsWith("/api/webhooks/");

  if (!user && !isAuthRoute && !isApiHealth && !isPublicShare && !isWebhook) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && url.pathname === "/login") {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
