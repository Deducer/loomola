# Loom Clone

Self-hosted screen recording with branded share pages. Replaces Loom with direct-to-R2 storage, Deepgram transcripts, and AI-generated titles/chapters/summaries.

## Status

**Milestone 1: Foundation** — deployed empty auth-gated app. Subsequent milestones add recording, upload, transcription, AI features, viewer page, comments, trim editing, and raw stream exports.

See:
- `docs/superpowers/specs/2026-04-22-loom-clone-design.md` — full Stage 1 design document
- `docs/superpowers/plans/2026-04-22-loom-clone-m1-foundation.md` — M1 implementation plan

## Stack

Next.js 15 • React 19 • TypeScript • Tailwind CSS 4 • Supabase (Postgres + Auth) • Drizzle ORM • Doppler (secrets) • Docker • Coolify (deployment) • Traefik (TLS + routing)

Future milestones add: Cloudflare R2, Deepgram, Claude (Vercel AI SDK), `pg-boss`, Plyr, Resend.

## Local dev

```bash
npm install
cp .env.example .env.local
# Fill in Supabase credentials in .env.local
npm run dev
```

## Commands

- `npm run dev` — Next.js dev server on :3000
- `npm run build` — production build
- `npm run test` — Vitest unit tests
- `npm run test:e2e` — Playwright E2E (requires TEST_CREATOR_EMAIL and TEST_CREATOR_PASSWORD)
- `npm run typecheck` — TypeScript check
- `npm run db:generate` — generate a Drizzle migration from schema changes
- `npm run db:migrate` — apply pending migrations

## Deployment

Auto-deploys to `https://loom.dissonance.cloud` on push to `main` via Coolify's GitHub connector. Secrets managed via Doppler; the only env var Coolify needs is `DOPPLER_TOKEN`.
