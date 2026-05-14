import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerActionItemsTool } from "./tools/action-items";
import { registerGetMediaTool } from "./tools/get-media";
import { registerRecentMeetingsTool } from "./tools/recent-meetings";
import { registerRecentRecordingsTool } from "./tools/recent-recordings";
import { registerSearchTool } from "./tools/search";

export function createLoomolaMcpServer(): McpServer {
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

  registerSearchTool(server);
  registerRecentRecordingsTool(server);
  registerRecentMeetingsTool(server);
  registerGetMediaTool(server);
  registerActionItemsTool(server);

  return server;
}
