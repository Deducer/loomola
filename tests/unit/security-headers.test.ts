import { afterEach, describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";
import { applySecurityHeaders } from "@/lib/security/headers";

function freshResponse(): NextResponse {
  return NextResponse.next();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("applySecurityHeaders — defaults", () => {
  const res = applySecurityHeaders(freshResponse());

  it("sets Strict-Transport-Security with 2-year max-age and preload", () => {
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
  });

  it("sets X-Content-Type-Options: nosniff", () => {
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets Referrer-Policy: strict-origin-when-cross-origin", () => {
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
  });

  it("sets a Permissions-Policy that allows camera/mic/display-capture from self only", () => {
    const p = res.headers.get("Permissions-Policy") ?? "";
    expect(p).toContain("camera=(self)");
    expect(p).toContain("microphone=(self)");
    expect(p).toContain("display-capture=(self)");
    expect(p).toContain("geolocation=()");
  });

  it("sets X-Frame-Options: SAMEORIGIN by default", () => {
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("sets a Content-Security-Policy with frame-ancestors 'self'", () => {
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("permits Google Fonts and R2 in CSP", () => {
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).toMatch(/connect-src[^;]*\*\.supabase\.co/);
    expect(csp).toMatch(/(media|connect)-src[^;]*r2\.cloudflarestorage\.com/);
  });

  it("omits unsafe-eval from production CSP", () => {
    vi.stubEnv("NODE_ENV", "production");
    const prod = applySecurityHeaders(freshResponse());
    const csp = prod.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});

describe("applySecurityHeaders — allowFraming for /bubble", () => {
  const res = applySecurityHeaders(freshResponse(), { allowFraming: true });

  it("omits X-Frame-Options when framing is allowed", () => {
    expect(res.headers.get("X-Frame-Options")).toBeNull();
  });

  it("does not pin frame-ancestors to 'self' when framing is allowed", () => {
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    // frame-ancestors should either be absent or relaxed; never pinned to self
    expect(csp).not.toContain("frame-ancestors 'self'");
  });

  it("still applies the other baseline headers", () => {
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });
});

describe("applySecurityHeaders — return value", () => {
  it("returns the same NextResponse it received", () => {
    const r = freshResponse();
    expect(applySecurityHeaders(r)).toBe(r);
  });
});
