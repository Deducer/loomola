import type { NextResponse } from "next/server";
import { storageCspOrigins } from "@/lib/r2/endpoint";

export interface SecurityHeaderOptions {
  /** Relax frame-related headers so the response can be embedded cross-origin
   * (used for the /bubble route, which the Chrome extension iframes into
   * arbitrary tabs). */
  allowFraming?: boolean;
}

const HSTS = "max-age=63072000; includeSubDomains; preload";
const REFERRER = "strict-origin-when-cross-origin";
const PERMISSIONS = [
  "camera=(self)",
  "microphone=(self)",
  "display-capture=(self)",
  "geolocation=()",
  "interest-cohort=()",
].join(", ");

function appOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCSP(opts: SecurityHeaderOptions): string {
  const scriptSrc = [
    "script-src",
    "'self'",
    "'unsafe-inline'",
    ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  ].join(" ");
  const storage = storageCspOrigins().join(" ");
  const app = appOrigin();
  // upgrade-insecure-requests would rewrite http://localhost:9000 (MinIO) and
  // http LAN deploys to https and break them; only emit it when the instance
  // itself is served over https.
  // NEXT_PUBLIC_APP_URL is a required env var (see env-check.ts) — an unset
  // value here means a misconfigured deploy, not a deliberate http instance.
  const httpsApp = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
  const directives = [
    "default-src 'self'",
    // 'unsafe-inline' on script-src is required by the share-page theme
    // bootstrap (inline <script> that flips html.dark before paint to avoid
    // theme flash) and various small Next.js-emitted inline bootstraps.
    // Next's development runtime also needs 'unsafe-eval'; keep that out of
    // production CSP.
    // Tightening to a nonce-based CSP is tracked as a follow-up.
    scriptSrc,
    // 'unsafe-inline' on style-src is required by Tailwind v4 runtime + Plyr
    // inline styles + brand custom-color injection.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https: data: blob:",
    `media-src 'self' ${storage} blob:`,
    ["connect-src 'self'", "https://*.supabase.co", "wss://*.supabase.co", storage].join(" "),
    "worker-src 'self' blob:",
    app ? `frame-src 'self' ${app}` : "frame-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(httpsApp ? ["upgrade-insecure-requests"] : []),
  ];
  if (!opts.allowFraming) {
    directives.push("frame-ancestors 'self'");
  }
  return directives.join("; ");
}

/**
 * Apply baseline HTTP security headers to a NextResponse.
 *
 * Idempotent — overwrites any existing values for the headers it sets.
 *
 * Pass `allowFraming: true` for routes that must be embeddable cross-origin
 * (specifically /bubble, which the Chrome extension injects into every tab).
 */
export function applySecurityHeaders(
  res: NextResponse,
  opts: SecurityHeaderOptions = {}
): NextResponse {
  res.headers.set("Strict-Transport-Security", HSTS);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", REFERRER);
  res.headers.set("Permissions-Policy", PERMISSIONS);
  res.headers.set("Content-Security-Policy", buildCSP(opts));

  if (opts.allowFraming) {
    res.headers.delete("X-Frame-Options");
  } else {
    res.headers.set("X-Frame-Options", "SAMEORIGIN");
  }

  return res;
}
