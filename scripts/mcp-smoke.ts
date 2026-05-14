import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number.parseInt(process.env.MCP_SMOKE_PORT ?? "3000", 10);
const BASE_URL = (process.env.MCP_SMOKE_URL ?? `http://localhost:${PORT}`).replace(
  /\/$/,
  ""
);
const MCP_URL = `${BASE_URL}/api/mcp`;
const TOKEN = process.env.MCP_TOKEN ?? `mcp-smoke-${randomUUID()}`;
const REQUIRED_TOOLS = [
  "loomola_search",
  "loomola_recent_recordings",
  "loomola_recent_meetings",
  "loomola_get_media",
  "loomola_action_items",
] as const;

type JsonMap = Record<string, unknown>;

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(MCP_URL, { method: "GET" });
    return res.status === 405 || res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerUp()) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${MCP_URL}`);
}

function startDevServer(): ChildProcessWithoutNullStreams {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "dev"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_TOKEN: TOKEN,
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });

  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    if (text.includes("Ready") || text.includes("Compiled /api/mcp")) {
      process.stdout.write(text);
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
  return child;
}

async function connectClient(): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
}> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    },
  });
  const client = new Client({ name: "loomola-mcp-smoke", version: "0.1.0" });
  await client.connect(transport);
  return { client, transport };
}

function parseToolJson(result: Awaited<ReturnType<Client["callTool"]>>): JsonMap {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (first?.type !== "text" || !first.text) {
    throw new Error("Tool returned no JSON text content");
  }
  return JSON.parse(first.text) as JsonMap;
}

function firstMediaSlug(...payloads: JsonMap[]): string | null {
  for (const payload of payloads) {
    for (const key of ["meetings", "recordings", "results"]) {
      const list = payload[key];
      if (Array.isArray(list) && typeof list[0]?.slug === "string") {
        return list[0].slug;
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  let child: ChildProcessWithoutNullStreams | null = null;
  try {
    const alreadyRunning = await isServerUp();
    if (!alreadyRunning) {
      child = startDevServer();
      child.once("exit", (code) => {
        if (code !== null && code !== 0) {
          console.error(`Next dev server exited early with code ${code}`);
        }
      });
    }

    await waitForServer();
    const { client, transport } = await connectClient();

    try {
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    for (const name of REQUIRED_TOOLS) {
      if (!names.has(name)) throw new Error(`Missing MCP tool: ${name}`);
    }

    const recordings = parseToolJson(
      await client.callTool({
        name: "loomola_recent_recordings",
        arguments: { limit: 3, daysBack: 365 },
      })
    );
    const meetings = parseToolJson(
      await client.callTool({
        name: "loomola_recent_meetings",
        arguments: { limit: 3, daysBack: 365 },
      })
    );
    const actions = parseToolJson(
      await client.callTool({
        name: "loomola_action_items",
        arguments: { status: "any", daysBack: 365, limit: 5 },
      })
    );
    const search = parseToolJson(
      await client.callTool({
        name: "loomola_search",
        arguments: {
          query: process.env.MCP_SMOKE_QUERY ?? "meeting notes",
          limit: 3,
          type: "any",
        },
      })
    );

    const slug = firstMediaSlug(meetings, recordings, search);
    if (!slug) {
      throw new Error("No recent/searchable media row found for get_media smoke");
    }

    const media = parseToolJson(
      await client.callTool({
        name: "loomola_get_media",
        arguments: {
          idOrSlug: slug,
          include: ["transcript", "actionItems", "chapters", "attendees"],
        },
      })
    );
    if (media.found !== true) {
      throw new Error(`get_media did not find selected slug ${slug}`);
    }

    const recordingCount = Array.isArray(recordings.recordings)
      ? recordings.recordings.length
      : 0;
    const meetingCount = Array.isArray(meetings.meetings)
      ? meetings.meetings.length
      : 0;
    const actionCount = Array.isArray(actions.actionItems)
      ? actions.actionItems.length
      : 0;
    const searchCount = Array.isArray(search.results) ? search.results.length : 0;

    console.log(
      [
        "MCP smoke passed",
        `tools=${REQUIRED_TOOLS.length}`,
        `recordings=${recordingCount}`,
        `meetings=${meetingCount}`,
        `actionItems=${actionCount}`,
        `searchResults=${searchCount}`,
        `getMedia=${slug}`,
      ].join(" ")
    );
    } finally {
      await transport.close();
      await client.close();
    }
  } finally {
    if (child) child.kill("SIGINT");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
