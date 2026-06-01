import { NextResponse } from "next/server";
import { bearerTokenMatches, describeTrust } from "../auth";

// Token-gated diagnostic for the MCP network-trust gate.
//
// Requires a valid `Authorization: Bearer <MCP_TOKEN>` (401 otherwise) and
// returns ONLY non-secret request inputs plus which trust rule matched —
// never the token or the Authorization header. It deliberately does NOT
// enforce the network gate (that gate is exactly what we're diagnosing), so
// a request with a valid token can see why it would be allowed or denied.
//
// Safe to leave deployed: it leaks no secrets and is unreachable without the
// token. To remove entirely, delete this folder (src/app/api/mcp/debug).
async function handle(request: Request): Promise<Response> {
  if (!bearerTokenMatches(request)) {
    return new Response(null, { status: 401 });
  }
  return NextResponse.json(describeTrust(request));
}

export const GET = handle;
export const POST = handle;
export const dynamic = "force-dynamic";
