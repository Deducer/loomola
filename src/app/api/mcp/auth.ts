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

export function verifyMcpRequest(
  request: Request,
  env?: Env
): McpAuthResult {
  const source = env ?? {
    MCP_TOKEN: process.env.MCP_TOKEN,
    MCP_ALLOW_PUBLIC: process.env.MCP_ALLOW_PUBLIC,
  };

  if (!isLoopbackRequest(request) && source.MCP_ALLOW_PUBLIC !== "true") {
    return { ok: false, status: 403 };
  }

  const expected = source.MCP_TOKEN;
  const actual = parseBearerToken(request.headers.get("authorization"));
  if (!expected || !actual || !constantTimeEqual(actual, expected)) {
    return { ok: false, status: 401 };
  }

  return { ok: true };
}
