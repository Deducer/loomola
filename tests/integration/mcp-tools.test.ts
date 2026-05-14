import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLoomolaMcpServer } from "@/app/api/mcp/server";

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  searchMedia: vi.fn(),
  recentRecordings: vi.fn(),
  recentNotes: vi.fn(),
  getMediaById: vi.fn(),
  openActionItems: vi.fn(),
}));

vi.mock("@/app/api/mcp/tools/owner", () => ({
  getMcpOwnerId: vi.fn(async () => "owner-1"),
}));

vi.mock("@/lib/embeddings/openai", () => ({
  getEmbeddingAdapter: () => ({
    embed: mocks.embed,
    modelVersion: "openai/text-embedding-3-small",
    dimensions: 1536,
  }),
}));

vi.mock("@/lib/recordings/queries", () => ({
  searchMedia: mocks.searchMedia,
  recentRecordings: mocks.recentRecordings,
  getMediaById: mocks.getMediaById,
}));

vi.mock("@/lib/notes/queries", () => ({
  recentNotes: mocks.recentNotes,
}));

vi.mock("@/lib/action-items/queries", () => ({
  openActionItems: mocks.openActionItems,
}));

const createdAt = new Date("2026-05-14T12:00:00.000Z");

async function connectClient() {
  const server = createLoomolaMcpServer();
  const client = new Client({ name: "mcp-tools-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, clientTransport, serverTransport };
}

function parseToolJson(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  expect(first?.type).toBe("text");
  return JSON.parse(first?.type === "text" ? (first.text ?? "{}") : "{}") as Record<
    string,
    unknown
  >;
}

describe("Loomola MCP tools", () => {
  beforeEach(() => {
    mocks.embed.mockResolvedValue([[1, ...Array.from({ length: 1535 }, () => 0)]]);
    mocks.searchMedia.mockResolvedValue({
      totalCandidates: 1,
      results: [
        {
          id: "media-1",
          slug: "search-hit",
          type: "audio",
          title: "Search Hit",
          summary: "A useful meeting.",
          createdAt,
          similarity: 0.91,
          shareUrl: "http://localhost:3000/notes/search-hit",
        },
      ],
    });
    mocks.recentRecordings.mockResolvedValue([
      {
        id: "video-1",
        slug: "video-one",
        type: "video",
        title: "Video One",
        summary: "A recording summary.",
        durationSeconds: 42,
        createdAt,
        shareUrl: "http://localhost:3000/v/video-one",
        thumbnailUrl: "http://signed-thumbnail",
      },
    ]);
    mocks.recentNotes.mockResolvedValue([
      {
        id: "audio-1",
        slug: "audio-one",
        type: "audio",
        title: "Audio One",
        summary: "A meeting summary.",
        durationSeconds: 120,
        attendees: [{ id: "person-1", name: "Ian", email: null }],
        folderName: "Project Win",
        createdAt,
        shareUrl: "http://localhost:3000/notes/audio-one",
      },
    ]);
    mocks.getMediaById.mockResolvedValue({
      media: {
        id: "audio-1",
        slug: "audio-one",
        type: "audio",
        durationSeconds: "120",
        status: "ready",
        createdAt,
      },
      title: "Audio One",
      summary: "A meeting summary.",
      shareUrl: "http://localhost:3000/notes/audio-one",
      folder: { name: "Project Win" },
      note: { body: "Raw notes." },
      transcript: { fullText: "Transcript text." },
      aiOutput: {
        actionItems: [{ text: "Ship Phase 1.", timestamp_sec: 10 }],
        chapters: [{ title: "Opening", start_sec: 0 }],
      },
      comments: [
        {
          id: "comment-1",
          commenterName: "Ian",
          timestampSec: "12",
          body: "Nice.",
          createdAt,
        },
      ],
      attendees: [{ id: "person-1", name: "Ian", email: null }],
    });
    mocks.openActionItems.mockResolvedValue([
      {
        id: "audio-1:0",
        text: "Ship Phase 1.",
        status: "open",
        mediaId: "audio-1",
        mediaTitle: "Audio One",
        mediaShareUrl: "http://localhost:3000/notes/audio-one",
        attributedTo: null,
        createdAt,
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists the five Phase 1 tools", async () => {
    const { client, server, clientTransport, serverTransport } =
      await connectClient();
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "loomola_action_items",
      "loomola_get_media",
      "loomola_ping",
      "loomola_recent_meetings",
      "loomola_recent_recordings",
      "loomola_search",
    ]);

    await clientTransport.close();
    await serverTransport.close();
    await server.close();
  });

  it("calls each Phase 1 tool and returns JSON text content", async () => {
    const { client, server, clientTransport, serverTransport } =
      await connectClient();

    const search = parseToolJson(
      await client.callTool({
        name: "loomola_search",
        arguments: { query: "project win", limit: 1 },
      })
    );
    expect(search.query).toBe("project win");

    const recordings = parseToolJson(
      await client.callTool({
        name: "loomola_recent_recordings",
        arguments: { limit: 1 },
      })
    );
    expect(recordings.recordings).toHaveLength(1);

    const meetings = parseToolJson(
      await client.callTool({
        name: "loomola_recent_meetings",
        arguments: { limit: 1 },
      })
    );
    expect(meetings.meetings).toHaveLength(1);

    const media = parseToolJson(
      await client.callTool({
        name: "loomola_get_media",
        arguments: { idOrSlug: "audio-one", include: ["comments", "attendees"] },
      })
    );
    expect(media.found).toBe(true);

    const actions = parseToolJson(
      await client.callTool({
        name: "loomola_action_items",
        arguments: { limit: 1 },
      })
    );
    expect(actions.actionItems).toHaveLength(1);

    await clientTransport.close();
    await serverTransport.close();
    await server.close();
  });

  it("returns a tool error for invalid input", async () => {
    const { client, server, clientTransport, serverTransport } =
      await connectClient();

    const result = await client.callTool({
      name: "loomola_search",
      arguments: { query: "no" },
    });

    expect(result.isError).toBe(true);

    await clientTransport.close();
    await serverTransport.close();
    await server.close();
  });
});
