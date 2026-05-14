import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyMcpRequest } from "./auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createServer(): McpServer {
  const server = new McpServer({
    name: "loomola",
    version: "0.1.0",
  });

  server.registerTool(
    "loomola_ping",
    {
      title: "Loomola MCP ping",
      description: "Health check for the Loomola MCP server.",
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: true, ts: Date.now() }),
        },
      ],
    })
  );

  return server;
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const auth = verifyMcpRequest(request);
  if (!auth.ok) return new Response(null, { status: auth.status });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createServer();

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
