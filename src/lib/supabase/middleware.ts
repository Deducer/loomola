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
  const isPublicViewerApi = url.pathname.startsWith("/api/v/");
  const isWebhook = url.pathname.startsWith("/api/webhooks/");
  // /bubble is the iframe target embedded by the Chrome extension into the
  // tab being recorded. The iframe can't carry our auth cookies (cross-
  // origin embedding), so it must be reachable without auth — the camera
  // permission is granted by the user inside the iframe at first use.
  const isBubbleIframe = url.pathname === "/bubble";
  const isBearerRecordingApi =
    url.pathname.startsWith("/api/recordings/") &&
    /^Bearer\s+.+/i.test(request.headers.get("authorization") ?? "");
  const isBearerNotesApi =
    url.pathname.startsWith("/api/notes/") &&
    /^Bearer\s+.+/i.test(request.headers.get("authorization") ?? "");
  const isBearerExportApi =
    url.pathname.startsWith("/api/export/") &&
    /^Bearer\s+.+/i.test(request.headers.get("authorization") ?? "");

  if (!user && !isAuthRoute && !isApiHealth && !isPublicShare && !isPublicViewerApi && !isWebhook && !isBubbleIframe && !isBearerRecordingApi && !isBearerNotesApi && !isBearerExportApi) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && url.pathname === "/login") {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
