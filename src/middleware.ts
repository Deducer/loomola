import { updateSession } from "@/lib/supabase/middleware";
import { applySecurityHeaders } from "@/lib/security/headers";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  // /bubble is the cross-origin iframe target the Chrome extension injects
  // into every tab. Other routes get the strict frame-ancestors policy.
  const allowFraming = request.nextUrl.pathname === "/bubble";
  return applySecurityHeaders(response, { allowFraming });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
