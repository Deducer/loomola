# Contributing to Loomola

Thanks for your interest. Loomola is a solo-maintained project that's used in production daily — contributions are welcome, but please read this first.

## Dev setup

Follow the README "Self-host Quickstart" — local dev needs Node 22, a Supabase project, and (for the full pipeline) Deepgram + Anthropic keys. `npm run doctor` verifies your setup.

```bash
npm install
npm run dev          # app at http://localhost:3000
npm run test         # unit tests (Vitest) — must pass
npm run typecheck    # strict TS — must pass
npm run lint         # ESLint
```

E2E tests (`npm run test:e2e`) need a running dev server plus `TEST_CREATOR_EMAIL` / `TEST_CREATOR_PASSWORD` in `.env.local`.

## Before opening a PR

- One change per PR. Small PRs get reviewed fast; sprawling ones don't.
- Unit tests for new logic. The suite is fast — run it.
- Match the existing style: CSS-var tokens (no ad-hoc hex colors), no premature abstraction, no speculative options.
- For features (vs fixes): open an issue first to check fit. The roadmap is opinionated.

## Areas where help is most welcome

- "This broke in my self-host setup" reports with reproduction details
- Loom/Granola import tooling
- Provider integrations behind the existing env-var abstractions (LLM, transcription, storage)

## Desktop app (macOS, `desktop/`)

Swift / SwiftUI, built with `desktop/scripts/install-local-app.sh`. Run `swift test` in `desktop/` before submitting.
