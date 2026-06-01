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
 * A Tailscale node gets BOTH an IPv4 in the CGNAT range 100.64.0.0/10
 * (100.64.0.0 – 100.127.255.255) AND an IPv6 in the ULA range
 * fd7a:115c:a1e0::/48. macOS prefers IPv6, so a tailnet request can
 * arrive with either family as its source — the original IPv4-only
 * check 403'd every IPv6 tailnet client. The /48 prefix is stable
 * across all tailnets, so matching it does not widen trust to the
 * public internet (fd7a:115c:a1e0::/48 is not publicly routable).
 */
export function isTailscaleIp(raw: string): boolean {
  let ip = raw.trim().toLowerCase();
  // Strip surrounding brackets and any IPv6 zone id ("[fe80::1%en0]").
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end !== -1) ip = ip.slice(1, end);
  }
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  // IPv4-mapped IPv6 ("::ffff:100.64.0.1") — unwrap to the IPv4 form.
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) ip = mapped[1] ?? ip;
  const v4 = ip.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const second = Number(v4[1]);
    return second >= 64 && second <= 127;
  }
  return ip.startsWith("fd7a:115c:a1e0:");
}

/**
 * The source-IP candidate as recorded by the most-recent reverse-proxy
 * hop (Traefik/Coolify). We read the LAST entry in X-Forwarded-For;
 * that's what Traefik appended from the real TCP socket, so a public
 * attacker cannot forge it (their own spoofed X-Forwarded-For values
 * land to the LEFT of Traefik's appended entry). Falls back to
 * X-Real-IP when X-Forwarded-For is absent.
 */
export function extractSourceCandidate(request: Request): {
  candidate: string | null;
  source: "x-forwarded-for" | "x-real-ip" | null;
} {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts.length > 0 ? parts[parts.length - 1] : null;
    if (last) return { candidate: last, source: "x-forwarded-for" };
  }
  const xri = request.headers.get("x-real-ip");
  if (xri && xri.trim()) return { candidate: xri.trim(), source: "x-real-ip" };
  return { candidate: null, source: null };
}

/**
 * Returns true if the request reached us over the tailnet — i.e. the
 * proxy-appended source IP is a Tailscale address (IPv4 CGNAT or IPv6
 * ULA). Lets tailnet members reach the MCP endpoint (DNS for the public
 * hostname is overridden to the tailnet IP) without MCP_ALLOW_PUBLIC=true;
 * public-internet requests are not recognized.
 */
export function isTailnetSourceRequest(request: Request): boolean {
  const { candidate } = extractSourceCandidate(request);
  return candidate !== null && isTailscaleIp(candidate);
}

/**
 * True if `raw` is a non-public address — i.e. the request demonstrably
 * entered through our own private network boundary (the Coolify/Docker
 * reverse proxy) rather than directly from a globally-routable client.
 *
 * Why this exists: in this deployment Docker MASQUERADEs every inbound
 * connection to the Coolify bridge gateway BEFORE Traefik sees it, so the
 * real client IP is destroyed and both tailnet and public requests reach
 * the app as `X-Forwarded-For: 10.0.1.1`. The app therefore cannot tell
 * tailnet from public by IP, and the bearer token (MCP_TOKEN) is the real
 * authenticator. This gate only insists the last hop is private/non-public
 * (fail closed on any public IP), which:
 *   - restores access today (10.0.1.1 is RFC1918), and
 *   - auto-upgrades to tailnet/private-only the moment real client-IP
 *     preservation is enabled (PROXY protocol or host-network proxy):
 *     public clients would then surface their real public IP here and be
 *     rejected, leaving only tailnet (100.64/10, fd7a:115c:a1e0::/48) and
 *     other private sources — with no code change required.
 */
export function isTrustedProxyHopIp(raw: string): boolean {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end !== -1) ip = ip.slice(1, end);
  }
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) ip = mapped[1] ?? ip;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10) return true; // 10.0.0.0/8 (Coolify/Docker bridge, RFC1918)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (Docker)
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale CGNAT 100.64/10
    return false; // any other IPv4 is public -> fail closed
  }
  if (ip === "::1") return true; // IPv6 loopback
  if (ip.startsWith("fe80:")) return true; // IPv6 link-local
  // IPv6 unique-local fc00::/7 (covers Tailscale fd7a:115c:a1e0::/48).
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;
  return false; // global IPv6 is public -> fail closed
}

/**
 * The network half of the gate: the request came through our private
 * reverse proxy (non-public last hop). See isTrustedProxyHopIp for why
 * this — not a strict tailnet-IP check — is the correct gate here.
 */
export function isTrustedNetworkRequest(request: Request): boolean {
  const { candidate } = extractSourceCandidate(request);
  return candidate !== null && isTrustedProxyHopIp(candidate);
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
    isTrustedNetworkRequest(request) ||
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

/**
 * Bearer-only check (does NOT consider the network gate). Used by the
 * token-gated diagnostic route so a holder of MCP_TOKEN can inspect why
 * the network gate is allowing/denying their request.
 */
export function bearerTokenMatches(request: Request, env?: Env): boolean {
  const expected = (env ?? { MCP_TOKEN: process.env.MCP_TOKEN }).MCP_TOKEN;
  const actual = parseBearerToken(request.headers.get("authorization"));
  return Boolean(expected && actual && constantTimeEqual(actual, expected));
}

/**
 * Non-secret snapshot of the trust inputs and decision, for diagnostics.
 * NEVER includes MCP_TOKEN or the Authorization header.
 */
export function describeTrust(request: Request, env?: Env) {
  const source = env ?? {
    MCP_TOKEN: process.env.MCP_TOKEN,
    MCP_ALLOW_PUBLIC: process.env.MCP_ALLOW_PUBLIC,
  };
  const { candidate, source: candidateSource } = extractSourceCandidate(request);
  const loopback = isLoopbackRequest(request);
  const trustedHop = isTrustedNetworkRequest(request);
  const allowPublic = source.MCP_ALLOW_PUBLIC === "true";
  const matchedRule = loopback
    ? "loopback"
    : trustedHop
      ? "trusted-proxy-hop"
      : allowPublic
        ? "allow-public"
        : null;
  return {
    host: requestHost(request),
    isLoopback: loopback,
    xForwardedFor: request.headers.get("x-forwarded-for"),
    xRealIp: request.headers.get("x-real-ip"),
    forwarded: request.headers.get("forwarded"),
    cfConnectingIp: request.headers.get("cf-connecting-ip"),
    candidate,
    candidateSource,
    // candidateIsTailscale is the upgrade signal: once real client-IP
    // preservation is enabled, a true value here means a genuine tailnet
    // client and the gate effectively becomes tailnet-only.
    candidateIsTailscale: candidate ? isTailscaleIp(candidate) : false,
    candidateIsTrustedHop: candidate ? isTrustedProxyHopIp(candidate) : false,
    allowPublic,
    matchedRule,
    networkTrusted: matchedRule !== null,
  };
}
