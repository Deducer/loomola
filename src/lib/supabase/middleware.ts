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

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;

  const url = request.nextUrl.clone();
  const isAuthRoute = url.pathname.startsWith("/login") ||
                      url.pathname.startsWith("/auth");
  const isApiHealth = url.pathname === "/api/health";
  // Public contact form on the landing page.
  const isContactApi = url.pathname === "/api/contact";
  // The root path is the public marketing landing for unauthed visitors.
  // page.tsx itself branches: shows LandingPage when user is null,
  // dashboard otherwise. Without this exception, middleware would
  // bounce unauthed traffic to /login before page.tsx ever ran.
  const isPublicLanding = url.pathname === "/";
  const isPublicShare = url.pathname.startsWith("/v/");
  const isPublicViewerApi = url.pathname.startsWith("/api/v/");
  const isWebhook = url.pathname.startsWith("/api/webhooks/");
  // /bubble is the iframe target embedded by the Chrome extension into the
  // tab being recorded. The iframe can't carry our auth cookies (cross-
  // origin embedding), so it must be reachable without auth — the camera
  // permission is granted by the user inside the iframe at first use.
  const isBubbleIframe = url.pathname === "/bubble";
  // Native clients (the macOS desktop app, future iOS, the
  // INTEGRATION_API_TOKEN holders) authenticate every API call
  // with `Authorization: Bearer ...`. Their requests don't carry
  // session cookies, so the redirect-to-/login path below would
  // bounce them to an HTML page. Each route's `requireAuth(request)`
  // does the actual bearer validation, so we can safely bypass the
  // cookie-session check for any /api/ path that carries a Bearer
  // header — invalid tokens still get rejected at the route level.
  //
  // Previously this bypass was hardcoded to /api/recordings/,
  // /api/notes/, /api/export/ — adding a new bearer-callable route
  // (e.g. /api/folders) silently broke until someone noticed the
  // 307→HTML response in a strict client. The general predicate
  // prevents that class of bug.
  const isBearerApi =
    url.pathname.startsWith("/api/") &&
    /^Bearer\s+.+/i.test(request.headers.get("authorization") ?? "");

  // First-run admin creation + invite acceptance: must be reachable signed-out.
  const isSetup = url.pathname === "/setup" || url.pathname.startsWith("/setup/accept/");

  if (!userId && !isAuthRoute && !isApiHealth && !isContactApi && !isPublicLanding && !isPublicShare && !isPublicViewerApi && !isWebhook && !isBubbleIframe && !isBearerApi && !isSetup) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (userId && url.pathname === "/login") {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (userId && url.pathname.startsWith("/setup")) {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
