import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyMcpRequest } from "./auth";
import { createLoomolaMcpServer } from "./server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleMcpRequest(request: Request): Promise<Response> {
  const auth = verifyMcpRequest(request);
  if (!auth.ok) return new Response(null, { status: auth.status });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createLoomolaMcpServer();

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function GET(): Promise<Response> {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE(): Promise<Response> {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
