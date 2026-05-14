# Loomola MCP Server — Design Document

**Date:** 2026-05-14
**Author:** Specified by Claude for Codex/Claude-Code build session
**Scope:** Add an MCP server inside the Loomola Next.js app at `/api/mcp` exposing typed tools for agent runtimes (Claude Code, Codex, Gemini, Cursor) to query meeting notes, recordings, action items, and structured AI outputs.

---

## Overview

Loomola captures the operator's highest-signal content: 4+ meetings/week + Loom recordings, with structured AI outputs (titles, summaries, chapters, action items, attendee tracking) and pgvector embeddings already in Postgres. The existing Obsidian export pipeline is **lossy** — it flattens action-item status, attendee links, vector similarity, and folder structure into markdown. Agent runtimes reading the markdown can't reconstruct those.

The MCP server exposes the structured data Loomola already has, so any AGENTS.md-conventioned agent runtime can ask precise questions ("open action items assigned to Tyler from last 14 days", "meetings about Vayu ICP", "what was decided in the Project Win sync on Tuesday").

---

## Goals

1. Expose 5–8 typed MCP tools backed by existing Drizzle queries against the live Loomola Postgres.
2. Co-locate inside the Loomola Next.js app — single deploy, shared auth, shared types, shared tests. No standalone server process.
3. Use Loomola's **existing** `vector(1536)` pgvector index for semantic search. Do not introduce a parallel vector DB.
4. Phase the build so a partial ship (Phase 1) is useful on its own.
5. Add a runnable end-to-end smoke that exercises the MCP from outside the Next.js process.

## Non-goals

- Multi-tenant or per-user MCP auth. Single-user is fine; service token is enough.
- Writing/mutation tools (start recording, regenerate summary). v1 is **read-only**. Mutations get their own spec.
- Real-time streaming of in-progress transcripts. Defer to v2.
- Hosting the MCP separately from the Next.js app. Anti-goal — defeats the point.
- Exposing the MCP on the public `loom.dissonance.cloud` domain in v1. Loopback-only for now (or behind explicit allow-list).

---

## High-Level Architecture

### Transport

**HTTP transport** via the Model Context Protocol's Streamable HTTP spec. The Next.js app's existing process hosts the MCP — one new route handler at `src/app/api/mcp/route.ts`.

Why HTTP over stdio:
- The Next.js app is already running long-lived (Coolify-managed). No reason to spawn a separate process per agent invocation.
- HTTP transport lets any MCP client (Claude Code, Codex, Cursor, Gemini, any future runtime) connect to one URL.
- Local-only by default: `http://localhost:3000/api/mcp`. Operator can later choose to expose `https://loom.dissonance.cloud/api/mcp` if they add an MCP-specific token rotation strategy.

### Auth

Bearer token in the `Authorization` header. Token comes from a new `MCP_TOKEN` env var (Doppler-managed, like every other secret in this repo).

- Constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks.
- Reject if `MCP_TOKEN` is unset OR the request token doesn't match.
- 401 with no body on auth failure. Don't leak whether the token exists.
- Allow loopback (`127.0.0.1`, `::1`) by default. For non-loopback, require an explicit `MCP_ALLOW_PUBLIC=true` env var so the operator opts in consciously.

### Service-layer factoring

Where existing API routes already encapsulate the query logic, **extract a shared service function** in `src/lib/<domain>/queries.ts` and have both the existing HTTP route AND the new MCP tool call it. Where the existing route is one-line trivial, the MCP tool can construct its own Drizzle query inline — don't over-refactor for refactor's sake.

Service-function candidates (extract these):
- `src/lib/recordings/queries.ts` — `recentRecordings()`, `getMediaById()`, `searchMedia()`
- `src/lib/notes/queries.ts` — `recentNotes()`, `getNoteById()`
- `src/lib/action-items/queries.ts` — `openActionItems()`, `actionItemsByPerson()`

Inline candidates (don't extract):
- Folder listings (`/api/folders` is already a one-liner)
- People listings (`/api/people` likewise)

---

## Tool Surface

### Phase 1 — must ship

These cover the operator's top use cases. If time gets tight, ship these and defer Phase 2 to a follow-up commit.

#### 1. `loomola_search`

The killer feature. Semantic + keyword search via the existing `vector(1536)` index.

**Input (Zod):**
```ts
z.object({
  query: z.string().min(3).max(500),
  limit: z.number().int().min(1).max(20).default(8),
  type: z.enum(["video", "audio", "any"]).default("any"),
  since: z.string().datetime().optional(), // ISO 8601; filter to media created on/after
})
```

**Behavior:**
1. Embed the query using the same embedding model already used to populate the `vector(1536)` columns (find this in `src/lib/ai/`).
2. Cosine-similarity query against the relevant `media_objects` rows (filtered by `type` if specified).
3. Return top N with: id, slug, type, title, 1–2 sentence summary, timestamp, similarity score, share-page URL.

**Output (Zod):**
```ts
z.object({
  results: z.array(z.object({
    id: z.string().uuid(),
    slug: z.string(),
    type: z.enum(["video", "audio"]),
    title: z.string(),
    summary: z.string(),
    createdAt: z.string().datetime(),
    similarity: z.number(),
    shareUrl: z.string().url(),
  })),
  query: z.string(),
  totalCandidates: z.number().int(),
})
```

#### 2. `loomola_recent_recordings`

**Input:**
```ts
z.object({
  limit: z.number().int().min(1).max(50).default(10),
  daysBack: z.number().int().min(1).max(365).default(30),
})
```

**Behavior:** Reuse logic from `src/app/api/recordings/recent/route.ts`. Filter `media_objects` where `type = 'video'`. Return id, slug, title, summary, duration, createdAt, shareUrl, thumbnail.

#### 3. `loomola_recent_meetings`

**Input:** Same shape as `loomola_recent_recordings`.

**Behavior:** Like above but `type = 'audio'`. Returns the meeting note view: id, title, summary, duration, attendees (list of names from people join), folder name, createdAt.

#### 4. `loomola_get_media`

**Input:**
```ts
z.object({
  idOrSlug: z.string().min(3),
  include: z.array(z.enum(["transcript", "actionItems", "chapters", "comments", "attendees"]))
           .default(["transcript", "actionItems", "chapters"]),
})
```

**Behavior:** Fetch a single `media_objects` row by id OR slug. Hydrate the requested includes via the existing joins. Truncate transcripts to 30K chars in the response with a `transcriptTruncated: true` flag if cut.

#### 5. `loomola_action_items`

**Input:**
```ts
z.object({
  status: z.enum(["open", "done", "any"]).default("open"),
  person: z.string().optional(), // filter by attendee name (case-insensitive contains)
  folder: z.string().optional(), // folder name
  daysBack: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(100).default(25),
})
```

**Behavior:** Query `action_items` (or whatever the canonical table is — check the schema), joined to `media_objects` for parent context. Return: id, text, status, mediaId, mediaTitle, mediaShareUrl, attributedTo (if speaker-assignment data exists), createdAt.

### Phase 2 — nice to have

Ship if time allows. Each is a thin variant of Phase 1 patterns.

#### 6. `loomola_people` — list known people + meeting count per person, optionally filtered by name substring.

#### 7. `loomola_folder` — list all media in a folder, with pagination.

#### 8. `loomola_search_by_speaker` — semantic search restricted to utterances attributed to a specific speaker, using the speaker-assignment data.

---

## File Tree

New files:
```
src/app/api/mcp/
  route.ts                ← MCP server, HTTP transport, ~200 lines
  auth.ts                 ← Bearer token verify (~30 lines)
  tools/
    search.ts             ← loomola_search implementation
    recent-recordings.ts
    recent-meetings.ts
    get-media.ts
    action-items.ts
    people.ts             (Phase 2)
    folder.ts             (Phase 2)
    search-by-speaker.ts  (Phase 2)
  README.md               ← how to add the MCP to ~/.claude.json + auth

src/lib/recordings/queries.ts   ← extracted service functions
src/lib/notes/queries.ts
src/lib/action-items/queries.ts

tests/unit/mcp-auth.test.ts
tests/integration/mcp-tools.test.ts

scripts/mcp-smoke.ts      ← end-to-end smoke: spawn dev server, call each tool, assert shape
```

Modified files:
- `.env.example` — add `MCP_TOKEN=` and `MCP_ALLOW_PUBLIC=false`
- `AGENTS.md` — add MCP section under "Infrastructure References" with the new URL + token reference
- `ROADMAP.md` — add row to the status table for MCP server
- `package.json` — add `@modelcontextprotocol/sdk` to dependencies; add `mcp-smoke` script

---

## Dependencies

Add via `npm install`:

- `@modelcontextprotocol/sdk` — latest stable

Everything else already exists in the repo (drizzle-orm, zod, the embedding helper, the postgres client).

---

## Implementation Milestones

Suggested order. Each milestone should be a clean commit and ideally a passing test run.

### M1 — Skeleton + auth (~30 min)

- Install `@modelcontextprotocol/sdk`.
- Create `src/app/api/mcp/route.ts` with a `POST` handler that boots an `McpServer`, registers ONE no-op tool `loomola_ping` (returns `{ ok: true, ts: Date.now() }`), and serves via Streamable HTTP transport.
- Create `src/app/api/mcp/auth.ts` with constant-time token comparison.
- Add `MCP_TOKEN` to `.env.example` with a clear comment.
- Write `tests/unit/mcp-auth.test.ts` covering: valid token, missing header, wrong token, unset env var.
- Verify with `curl` that you can list tools through the MCP transport.

### M2 — Service-layer extraction (~30 min)

- Create `src/lib/recordings/queries.ts` with `recentRecordings()`, `getMediaById()`, `searchMedia()` (search may be a stub until M3).
- Create `src/lib/notes/queries.ts` and `src/lib/action-items/queries.ts` likewise.
- Refactor the existing routes that have non-trivial logic to call the new service functions. Do NOT change route response shapes — they're consumed by the existing UI and the Chrome extension.
- Tests should still pass.

### M3 — Phase 1 tools (~60–90 min)

Implement the 5 Phase 1 tools, one per file under `tools/`. Each tool:
- Validates input with Zod.
- Calls the service function.
- Returns a structured `content: [{ type: 'text', text: JSON.stringify(...) }]` response per the MCP spec.

Write `tests/integration/mcp-tools.test.ts` that spins up a test server, calls each tool with valid + invalid input, and asserts the response shape.

### M4 — Smoke + docs (~20 min)

- Write `scripts/mcp-smoke.ts` that uses the MCP SDK's client to connect, list tools, call each Phase 1 tool against a real (or seeded) database, and prints a summary.
- Write `src/app/api/mcp/README.md` covering: how to add to `~/.claude.json` (Claude Code), how to add to Codex CLI's MCP config, sample tool invocations.
- Add `npm run mcp-smoke` script to `package.json`.

### M5 — Phase 2 tools (only if M1–M4 done and time remains)

Each Phase 2 tool follows the M3 pattern. Skip if scope tight.

---

## Acceptance Criteria

The build is "shippable" when:

1. `npm test` passes (existing tests still green + new MCP tests).
2. `npm run mcp-smoke` exits 0 against the local dev server with at least one real `media_objects` row in the database.
3. The operator can add this entry to `~/.claude.json` and successfully invoke any Phase 1 tool from a Claude Code session:
   ```json
   {
     "mcpServers": {
       "loomola": {
         "type": "http",
         "url": "http://localhost:3000/api/mcp",
         "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
       }
     }
   }
   ```
4. `AGENTS.md` and `ROADMAP.md` updated.
5. No lossy abstractions: `loomola_get_media` with `include: ["transcript"]` returns the FULL transcript text (truncated at 30K with a flag) — not a summary-of-the-transcript.

---

## Testing Approach

Match the repo's existing patterns:

- **Vitest unit** for `auth.ts` (token compare, header parsing, env-var handling).
- **Vitest integration** for `tools/*.ts` — spin up a test Postgres (Drizzle test setup if it exists, else mock the query layer).
- **Smoke script** (`scripts/mcp-smoke.ts`) — real end-to-end against `npm run dev`. This is the test that proves a real MCP client can talk to the real server.

Do **not** add Playwright tests for the MCP. Playwright is for browser flows; MCP is an HTTP API.

---

## Operator setup (post-build)

After Codex finishes, the operator (Ian) does:

1. `doppler secrets set MCP_TOKEN=$(openssl rand -hex 32)` — provision the token in Doppler.
2. `doppler run -- npm run dev` — start Loomola locally with the token loaded.
3. Add the entry above to `~/.claude.json`, substituting the actual token.
4. In a fresh Claude Code session, ask "what are my open action items from last week" — Claude should invoke `loomola_action_items` automatically.

---

## Security notes

- Loopback-only by default. The route handler checks `req.headers.get('host')` and rejects non-loopback unless `MCP_ALLOW_PUBLIC=true`.
- Token must be in env, never in code, never in git, never logged.
- Don't expose internal Postgres IDs that could be enumerated to discover other users' content. Single-user means this is moot today, but future-proof by using slugs in MCP responses where the existing UI uses slugs.
- Rate-limit at the MCP layer? **Skip for v1.** Single user, loopback-only. Revisit if/when public exposure happens.

---

## Open Questions (Codex: answer in this section as you decide; do not stop to ask)

1. **Embedding helper location.** Answer: `src/lib/embeddings/openai.ts` exposes `getEmbeddingAdapter()`, defaulting to `EMBEDDING_PROVIDER=openai` and `text-embedding-3-small` with 1536 dimensions. `loomola_search` reuses that helper and queries `summary_embeddings.embedding` via pgvector cosine distance.

2. **Action-items table shape.** Answer: there is no dedicated `action_items` table. Action items are stored as JSONB on `ai_outputs.action_items`, shaped by `src/lib/ai/schemas.ts` as `{ text, timestamp_sec }[]`. Phase 1 exposes them as read-only "open" items; `status: "done"` returns an empty list because no persisted completion state exists yet.

3. **Speaker assignment data shape.** Answer: speaker mapping exists in `speaker_assignments` (`media_object_id`, `speaker_idx`, `person_id`, `display_label_override`, suggestion/dismissal metadata) and joins to `people`. Phase 2 `loomola_search_by_speaker` is deferred because the indexed `summary_embeddings` rows are media-level and `transcript_chunks` do not currently persist speaker attribution, so speaker-restricted semantic search would need a chunk/speaker join design rather than a thin Phase 1 variant.

4. **Streamable HTTP transport stateful vs stateless.** Answer: v1 uses the MCP SDK's stateless per-request `WebStandardStreamableHTTPServerTransport` with JSON responses enabled. The route is read-only, does not send server-initiated notifications, and Next.js route handlers map cleanly to a fresh web-standard `Request`/`Response` per call. That avoids module-global session maps during dev hot reloads and still speaks Streamable HTTP to Claude Code/Codex clients.

5. **Tool response truncation.** Answer: keep the 30K character limit for `loomola_get_media` transcript output. It preserves full useful context for normal meetings while staying below the point where MCP clients start getting unwieldy. The tool returns `transcriptTruncated: true` when it cuts the transcript, and all other transcript content remains available in the database for future paginated/chunked tools.

---

## What this is NOT

This spec does not require Codex to:

- Touch the Chrome extension, desktop app, or Swift code.
- Modify any existing UI surface (Notes dashboard, viewer page, etc.).
- Add a Loomola UI for managing MCP tokens. Doppler is the UI.
- Build any mutation tools. Read-only v1.
- Refactor existing routes for refactor's sake — only extract service functions where the MCP needs the same logic.

When in doubt, ship the minimum that satisfies acceptance criteria. Polish in a follow-up commit.
