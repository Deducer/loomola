# Loomola MCP Server

Loomola exposes a local-only Streamable HTTP MCP endpoint at:

```text
http://localhost:3000/api/mcp
```

Auth is a bearer token from `MCP_TOKEN`. Store it in Doppler (`dissonance-cloud` / `prd_loom`) and keep `MCP_ALLOW_PUBLIC=false` unless you intentionally expose the route beyond loopback.

## Local Setup

```bash
doppler secrets set MCP_TOKEN="$(openssl rand -hex 32)"
doppler run --project dissonance-cloud --config prd_loom -- npm run dev
npm run mcp-smoke
```

Optional owner overrides:

```text
MCP_OWNER_ID=<auth.users.id>
MCP_OWNER_EMAIL=you@example.com
```

If neither is set, v1 uses the first `auth.users` row because Loomola is single-user today.

## Claude Code

Add this to `~/.claude.json`:

```json
{
  "mcpServers": {
    "loomola": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_TOKEN}"
      }
    }
  }
}
```

## Codex

Add an HTTP MCP server entry to `~/.codex/config.toml`:

```toml
[mcp_servers.loomola]
url = "http://localhost:3000/api/mcp"
headers = { Authorization = "Bearer ${MCP_TOKEN}" }
```

Restart/reload the agent runtime after changing MCP config.

## Phase 1 Tools

- `loomola_search` — semantic search over `summary_embeddings`
- `loomola_recent_recordings` — recent video recordings
- `loomola_recent_meetings` — recent audio notes/meetings
- `loomola_get_media` — single media object with optional transcript/action/chapter/comment/attendee hydration
- `loomola_action_items` — JSONB-backed AI action items

Example tool arguments:

```json
{ "query": "Project Win ICP", "limit": 5, "type": "any" }
```

```json
{ "status": "open", "person": "Ian", "daysBack": 14, "limit": 25 }
```

```json
{ "idOrSlug": "meeting-slug", "include": ["transcript", "actionItems"] }
```
