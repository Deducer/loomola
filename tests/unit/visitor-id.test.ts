import { describe, it, expect, beforeAll } from "vitest";
import { hashVisitor } from "@/lib/viewer/visitor-id";

beforeAll(() => {
  process.env.VISITOR_HASH_SALT = "b".repeat(64);
});

function req(ip: string | null, ua: string | null): Request {
  const headers = new Headers();
  if (ip) headers.set("x-forwarded-for", ip);
  if (ua) headers.set("user-agent", ua);
  return new Request("http://example.com/", { headers });
}

describe("hashVisitor", () => {
  it("returns a 64-char hex digest", () => {
    expect(hashVisitor(req("1.2.3.4", "Chrome/130"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same inputs", () => {
    const a = hashVisitor(req("1.2.3.4", "Chrome/130"));
    const b = hashVisitor(req("1.2.3.4", "Chrome/130"));
    expect(a).toBe(b);
  });

  it("differs when IP changes", () => {
    const a = hashVisitor(req("1.2.3.4", "Chrome/130"));
    const b = hashVisitor(req("9.9.9.9", "Chrome/130"));
    expect(a).not.toBe(b);
  });

  it("differs when UA changes", () => {
    const a = hashVisitor(req("1.2.3.4", "Chrome/130"));
    const b = hashVisitor(req("1.2.3.4", "Firefox/120"));
    expect(a).not.toBe(b);
  });

  it("returns a stable hash when IP and UA are absent", () => {
    const a = hashVisitor(req(null, null));
    const b = hashVisitor(req(null, null));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("takes the LAST (proxy-appended) IP from a forwarded-for list", () => {
    const a = hashVisitor(req("1.2.3.4, 5.6.7.8", "Chrome/130"));
    const b = hashVisitor(req("5.6.7.8", "Chrome/130"));
    expect(a).toBe(b);
  });

  it("is spoof-resistant: client-prepended XFF entries do not change the hash", () => {
    // Traefik appends the real socket IP on the right; anything the client
    // sends arrives to the left of it. Rotating those left entries must not
    // mint a new visitor identity (rate-limit bypass, first-view email flood).
    const real = hashVisitor(req("5.6.7.8", "Chrome/130"));
    const spoofA = hashVisitor(req("6.6.6.6, 5.6.7.8", "Chrome/130"));
    const spoofB = hashVisitor(req("7.7.7.7, 8.8.8.8, 5.6.7.8", "Chrome/130"));
    expect(spoofA).toBe(real);
    expect(spoofB).toBe(real);
  });
});
