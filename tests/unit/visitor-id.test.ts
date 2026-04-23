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

  it("takes the first IP from a comma-separated forwarded-for list", () => {
    const a = hashVisitor(req("1.2.3.4, 5.6.7.8", "Chrome/130"));
    const b = hashVisitor(req("1.2.3.4", "Chrome/130"));
    expect(a).toBe(b);
  });
});
