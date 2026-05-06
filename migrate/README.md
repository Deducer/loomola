# loomola-migrate

CLI tool that imports a Granola backlog (notes, transcripts, AI summaries, attendees, lists) into a self-hosted Loomola.

## Requirements

- macOS (Granola is Mac-only)
- Granola desktop app installed and signed in
- A Loomola server you can reach over HTTPS

## Status

**v0.1.0 — beta.** The infrastructure works end-to-end: HTTP client, rate limiter, run-state file, ProseMirror→Markdown converter, server endpoint, settings page. Every piece has unit tests; 23/23 passing as of commit.

**Known gap on current Granola desktop builds.** Beginning roughly with `cache-v6.json`, Granola encrypts the local notes cache. The reverse-engineered approach this CLI uses (read `cache-v*.json` plaintext) returns no notes on those builds — only UI state. Two paths forward, both supported by the architecture:

1. **Older Granola desktop versions** that wrote `cache-v3.json` or `cache-v4.json` plaintext. The reader walks v6 → v5 → v4 → v3 in newest-first order; it'll find whichever you have.
2. **Granola Business or Enterprise tier**, where the [official API](https://docs.granola.ai/introduction) exposes `/v2/get-documents` + `/v1/get-document-transcript`. Adding an API-only code path (skip the cache, hit the server directly) is small and not yet wired.

If you're on a current free/Pro Granola, the data is locally encrypted and not extractable until the community catches up to cache-v6 decryption (or you upgrade to Business for a month).

## Install (developer path)

```sh
cd migrate
bun install
```

Pre-built binaries from `./scripts/build.sh` will land once the API-only path is wired.

## Usage

```sh
bun run src/cli.ts granola \
  --server=https://loom.dissonance.cloud \
  --token=<paste-from-settings-migration>
```

Preview without writing:

```sh
bun run src/cli.ts granola --dry-run --token=...
```

Resume an interrupted run:

```sh
bun run src/cli.ts granola --resume --token=...
```

Retry only previously-failed notes:

```sh
bun run src/cli.ts granola --retry-failed --token=...
```

## What gets imported

- Note title, body (Markdown, converted from Granola's ProseMirror), AI summary, meeting date, duration, meeting URL
- Transcripts (cached locally + fetched live for un-cached ones)
- Attendees → `people` rows (your own marked `is_self`)
- Granola Lists → Loomola folders (multi-list mapped via `media_folder_assignments`)
- Speaker attribution → `speaker_assignments`

## What does NOT get imported

- **Audio.** Granola does not record or store audio anywhere — there's nothing to import.
- **Custom Granola template blocks** (polls, decision blocks, etc.) flatten to plain text.
- **Notes that are calendar invites you didn't host** (silently filtered out).

## Idempotency

Re-runs are safe. Existing notes get *missing* fields filled in, never overwritten. If you edit an imported note in Loomola, the next migration run won't undo your changes.

## Files this CLI reads

- `~/Library/Application Support/Granola/cache-v{6,5,4,3}.json` — your local Granola cache. Snapshotted to `/tmp` before parsing, so it's safe to run while Granola is open. (See "Status" above for the cache-v6 encryption caveat.)
- `~/Library/Application Support/Granola/supabase.json` — your Granola WorkOS auth tokens. Used only to fetch transcripts that aren't in the local cache, via Granola's reverse-engineered `/v1/get-document-transcript` endpoint.

## State file

`~/.loomola-migrate/state.json` records which notes succeeded, failed, or were skipped. It's the source of truth for `--resume` and `--retry-failed`. Safe to delete if you want a clean re-run — server-side merge idempotency handles the dedup.

## Testing

```sh
cd migrate
bun test
```

23 tests across 4 files: run-state atomic writes, ProseMirror→Markdown, cache-reader fixture parsing, API-client rate-limiter + 401-refresh-retry.

## Disclaimer

This tool reads your own Granola data via your local Granola desktop session. It does not bypass any payment gate. Use at your own risk.
