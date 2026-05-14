import { timingSafeEqual } from "node:crypto";

type Env = {
  MCP_TOKEN?: string;
  MCP_ALLOW_PUBLIC?: string;
};

export type McpAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 };

function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...parts] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || parts.length !== 1) return null;
  return parts[0] ?? null;
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  const length = Math.max(actualBytes.length, expectedBytes.length, 1);
  const paddedActual = Buffer.alloc(length);
  const paddedExpected = Buffer.alloc(length);
  actualBytes.copy(paddedActual);
  expectedBytes.copy(paddedExpected);
  return (
    timingSafeEqual(paddedActual, paddedExpected) &&
    actualBytes.length === expectedBytes.length
  );
}

function requestHost(request: Request): string {
  const host = request.headers.get("host");
  if (host) {
    try {
      return new URL(`http://${host}`).hostname.toLowerCase();
    } catch {
      return host.toLowerCase();
    }
  }
  return new URL(request.url).hostname.toLowerCase();
}

export function isLoopbackRequest(request: Request): boolean {
  const host = requestHost(request);
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

/**
 * Returns true if the request's source IP — as recorded by the
 * most-recent reverse-proxy hop (Traefik/Coolify) — falls inside
 * Tailscale's CGNAT range (100.64.0.0/10). We read the LAST entry
 * in X-Forwarded-For; that's what Traefik just appended based on
 * the real TCP socket, so a public attacker cannot forge it.
 * Falls back to X-Real-IP when X-Forwarded-For is absent.
 *
 * Net effect: requests that reach Loomola via tailnet (because
 * DNS for the public hostname is overridden to the tailnet IP
 * for tailnet members) are recognized as private-network traffic
 * without needing MCP_ALLOW_PUBLIC=true. Requests from the
 * public internet are not.
 */
export function isTailnetSourceRequest(request: Request): boolean {
  const xff = request.headers.get("x-forwarded-for");
  let candidate: string | null = null;
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    candidate = parts.length > 0 ? (parts[parts.length - 1] ?? null) : null;
  }
  if (!candidate) {
    const xri = request.headers.get("x-real-ip");
    if (xri) candidate = xri.trim();
  }
  if (!candidate) return false;
  // Tailscale CGNAT: 100.64.0.0/10 covers 100.64.0.0 – 100.127.255.255.
  const match = candidate.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 64 && second <= 127;
}

export function verifyMcpRequest(
  request: Request,
  env?: Env
): McpAuthResult {
  const source = env ?? {
    MCP_TOKEN: process.env.MCP_TOKEN,
    MCP_ALLOW_PUBLIC: process.env.MCP_ALLOW_PUBLIC,
  };

  const trusted =
    isLoopbackRequest(request) ||
    isTailnetSourceRequest(request) ||
    source.MCP_ALLOW_PUBLIC === "true";

  if (!trusted) {
    return { ok: false, status: 403 };
  }

  const expected = source.MCP_TOKEN;
  const actual = parseBearerToken(request.headers.get("authorization"));
  if (!expected || !actual || !constantTimeEqual(actual, expected)) {
    return { ok: false, status: 401 };
  }

  return { ok: true };
}
