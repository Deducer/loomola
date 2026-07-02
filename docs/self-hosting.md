# Self-Hosting Runbook

For getting your instance _live_ see the [quickstart in the README](../README.md).
This document covers keeping a live instance healthy: monitoring, backups,
upgrades, and troubleshooting.

## Architecture at a glance

A single Docker container runs the Next.js application, pg-boss background
workers, and the `ffmpeg`-based thumbnail/sprite jobs. Everything external is
a service you bring:

| Component | What it does | Swappable? |
|---|---|---|
| **App container** (`node:22-alpine`) | Serves HTTP, processes uploads, runs AI pipeline | Build from source |
| **Supabase** | Postgres database, Auth, Realtime | No — `auth.users` FKs make this the one required external account |
| **Object storage** | Stores video files, thumbnails, sprites, brand logos | Yes — Cloudflare R2 or any S3-compatible store (MinIO bundled in compose) |
| **Transcription** | Converts audio to text | Yes — Deepgram (default, async webhook) or OpenAI Whisper (sync, no callback needed) |
| **LLM** | Generates titles, summaries, chapters, action items | Yes — Anthropic Claude (default), swappable via `LLM_PROVIDER` / `LLM_MODEL` |
| **Email (optional)** | Comment and first-view notifications | Yes — Mailgun; when unconfigured, email sends are no-ops and invite links are shown in the UI |

The app container is the only persistent process you deploy. pg-boss runs
inside it — no Redis, no separate worker process. If the container restarts,
pg-boss re-warms within seconds of boot via the Next.js instrumentation hook
(`src/instrumentation.ts`).

## Health monitoring

### The `/api/health` endpoint

`GET /api/health` returns a JSON object and an HTTP status code. It is
intentionally public (no auth) and non-sensitive.

```json
{
  "status": "ok",
  "ts": "2026-06-11T14:00:00.000Z",
  "commit": "aac095c",
  "db": "ok",
  "boss": {
    "started": true,
    "queues": [
      {
        "name": "transcribe",
        "pending": 0,
        "active": 0,
        "failed": 0,
        "oldestPendingSec": null
      }
    ]
  }
}
```

Fields:

| Field | Type | Meaning |
|---|---|---|
| `status` | `"ok" \| "degraded" \| "down"` | Overall verdict |
| `ts` | ISO timestamp | Server time at the moment of the check |
| `commit` | short SHA | The build that is running (`NEXT_PUBLIC_BUILD_COMMIT`) |
| `db` | `"ok" \| "down"` | Whether a `SELECT 1` against Supabase Postgres succeeded |
| `boss.started` | boolean | Whether the pg-boss instance has been started (workers are polling) |
| `boss.queues[].name` | string | pg-boss queue name |
| `boss.queues[].pending` | number | Jobs in `created` or `retry` state |
| `boss.queues[].active` | number | Jobs currently being processed |
| `boss.queues[].failed` | number | Jobs that have exhausted retries |
| `boss.queues[].oldestPendingSec` | number \| null | Seconds since the oldest pending job was created; null if queue is empty |

**Status semantics:**

- `"ok"` (HTTP 200) — database up, pg-boss started, no failed jobs, no queue
  backlogs older than 10 minutes.
- `"degraded"` (HTTP 200) — database is up but one or more of: pg-boss not
  yet started, at least one failed job in a queue, or a pending job older than
  10 minutes. The app continues to serve traffic; background processing is
  impaired. An uptime monitor should alert on degraded but not page the same
  as "down".
- `"down"` (HTTP 503) — database check failed. Auth, dashboard, and share
  pages are all broken. Page immediately.

### Wiring an uptime monitor

Any monitor that can check HTTP status codes works. Recommended setup:

- **Check URL:** `https://your-domain.com/api/health`
- **Expected status:** 200 (both `ok` and `degraded` return 200; only `down`
  returns 503)
- **Check interval:** every 1–2 minutes
- **Alert on:** `status` field equals `"down"` (parse the JSON body), OR HTTP
  503, OR the endpoint is unreachable
- **Optional deeper alert:** parse `boss.started` false or any `failed` count
  greater than 0 for an "investigate" (non-paging) alert

[UptimeRobot](https://uptimerobot.com) free tier works fine. Set the monitor
type to "HTTP(S)", keyword monitoring for the word `"down"` in the response
body covers the database failure case as a belt-and-braces check.

### What "degraded" means in practice

| Degraded signal | Likely cause | Action |
|---|---|---|
| `boss.started: false` | Container just restarted; instrumentation hook has not fired yet | Wait 30s and re-check; if persistent, look at container logs for boot errors |
| `boss.started: false` (persistent) | pg-boss boot-warm failed (logged as `[instrumentation] pg-boss boot warm-up failed`) | Check `DATABASE_URL` is reachable; restart container |
| `queues[].failed > 0` | At least one job exhausted its retries | Check the recording's `failure_reason` in the dashboard Retry button, or query `pgboss.job` for `state = 'failed'` |
| `queues[].oldestPendingSec > 600` | Workers are not consuming the queue fast enough | Likely a cold start that hasn't processed; if persists > 10 minutes, restart container |

## Backups

### What to back up

**Supabase Postgres** is the authoritative store for all structured data:
recordings metadata, transcripts, AI outputs, folders, notes, users, invites,
people, speaker assignments, rate-limit events. Back this up.

```bash
# Point DATABASE_URL at your Supabase project's direct connection string
# (not the pooler — pg_dump needs a direct connection)
pg_dump "$DATABASE_URL" \
  --no-owner --no-acl \
  --format=custom \
  --file="loomola-$(date +%Y%m%d).dump"
```

Supabase Cloud projects also have continuous point-in-time recovery (PITR) on
paid plans. Free tier has 7-day automatic daily backups in the Supabase
dashboard under Settings → Database → Backups. For self-hosted Supabase,
configure your own `pg_dump` cron job.

**Object storage** holds all video files, audio files, thumbnails, preview
sprites, brand logos, and note image attachments. Back this up.

For MinIO (the bundled compose option):

```bash
# Install the MinIO client (mc) first: https://min.io/docs/minio/linux/reference/minio-mc.html
mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mirror local/loomola /backup/loomola-bucket/
```

For Cloudflare R2, use `rclone`:

```bash
# Configure rclone with your R2 credentials first
rclone sync r2:your-bucket-name /backup/loomola-bucket/
```

Suggested backup cadence: daily database dump + weekly full bucket sync.

### Deletion and the trash

Deleting a recording moves it to the trash (`/trash` in the app), where it can
be restored for `TRASH_RETENTION_DAYS` days (default 30). After that a daily
`purge_deleted` pg-boss job permanently removes its storage objects and
database rows. "Delete forever" on the trash page does the same immediately.
Purged data is only recoverable from your own backups — size your backup
retention with that in mind.

### What is safe to lose

**Thumbnails and preview sprites** (`thumbnail_key`, `preview_sprite_key`) are
regenerated by the `thumbnail` and `preview_sprite` pg-boss jobs. If you lose
these files, mark the affected recording rows' `thumbnail_key` /
`preview_sprite_key` null, then use the Retry button on the recording's edit
page to re-enqueue the pipeline from the appropriate stage.

Raw audio tracks (`r2_mic_key`, `r2_system_key`) can also be regenerated from
source if you have the mixed audio, though re-mixing is a manual step. The
composite video and mixed audio are the most important files to keep.

### Restore outline

1. Provision a fresh Supabase project (or restore from PITR if using paid tier).
2. Restore the Postgres dump: `pg_restore --dbname "$DATABASE_URL" loomola-YYYYMMDD.dump`
3. Restore the storage bucket to your MinIO / R2 bucket.
4. Update environment variables if the Supabase project URL or bucket name changed.
5. Deploy the container. Migrations run at boot and are forward-only (no-ops if already applied).
6. Verify with `npm run doctor` and `GET /api/health`.

## Upgrades

The upgrade procedure is intentionally simple:

```bash
git pull origin main
docker compose --env-file .env.compose up -d --build
```

Migrations run automatically at container boot via `scripts/migrate.ts`. They
are additive-only (new columns have defaults, new tables do not break old
queries, dropped columns are never removed in the same migration that removes
their usage). If the migration step fails, the container exits with a non-zero
code and Compose will not replace the running container — the old container
keeps serving traffic.

**Before upgrading:** read `CHANGELOG.md` for the release you are moving to.
Any manual action required (rare) is called out explicitly there.

**Rollback:** redeploy the previous commit hash:

```bash
git checkout <previous-commit>
docker compose --env-file .env.compose up -d --build
```

Note that applied migrations do not reverse on rollback. If the previous
version's code is incompatible with the new schema (e.g., it reads a column
that was renamed), you will need to restore from a backup taken before the
upgrade. In practice this has never happened because the additive-only
philosophy means old code can always read new schema — new nullable columns
just return null, new tables are ignored. Check the CHANGELOG entry for any
schema-incompatible changes before rolling back.

## Troubleshooting

### Diagnosis first: run doctor

Before digging into logs, run the diagnostic script against your configuration:

```bash
npm install  # if you haven't already
npm run doctor
```

Doctor performs live checks: database `SELECT 1`, storage `HeadBucket` +
round-trip put/delete, Deepgram key validation (if using Deepgram), LLM
one-token ping, and notes the app URL. One line per check. Fix the failing
line first — most setup failures trace to a single misconfigured variable.

### Symptom lookup

| Symptom | Doctor / health signal | Likely cause | Fix |
|---|---|---|---|
| **Recording stays in "transcribing"** | `boss.started: false` or queue pending old | (a) Deepgram cannot reach the callback URL (b) pg-boss workers dead | (a) Use `TRANSCRIBE_PROVIDER=openai-whisper` or set `NEXT_PUBLIC_APP_URL` to a public HTTPS URL (b) Restart container; check instrumentation hook log line |
| **Recording shows "Failed" with a reason** | `failure_reason` on the card | Transcription error, LLM auth failure, upload error | Click **Retry** on the card — owner retry re-runs from the correct stage (re-transcribes if no transcript; re-runs AI if transcript exists) |
| **Recording stuck > 2 hours** | Watchdog marks it failed | The watchdog runs every 10 minutes. After 2h in `transcribing` or 1h in `processing`, the recording is automatically marked failed with a reason | Click Retry; check `failure_reason` to understand what failed |
| **Workers not polling** | `boss.started: false` in `/api/health` | Instrumentation hook failed; rare race on cold start | Check container logs for `[instrumentation]` lines; restart container |
| **Upload fails on part upload** | Browser console shows network error | Transient network issue | The upload coordinator retries 3× with backoff and requests fresh presigned URLs. If all retries fail, a browser warning appears before navigating away |
| **Upload fails with ETag error** | R2/MinIO CORS | `ETag` header not exposed in bucket CORS | Add `ExposeHeaders: ["ETag"]` to CORS policy on the bucket |
| **MinIO: uploads succeed but video won't play** | `media-src` CSP | The storage origin is not in the Content Security Policy | Set `NEXT_PUBLIC_APP_URL` correctly; the CSP `media-src` is derived from the storage endpoint via `S3_ENDPOINT` or the R2 account ID |
| **Brownout page instead of JSON** | Desktop app shows "service unavailable" error | Reverse proxy (Traefik, Coolify, nginx) is returning an HTML error page | The desktop client detects HTML responses and shows a typed "service unavailable" error; the server is unreachable. Check your reverse proxy and container health |
| **pg-boss jobs dead after restart** | `boss.started: false`, jobs piling up | Historical issue (resolved in Stage 10): instrumentation hook now warms pg-boss at boot. If still happening, `DATABASE_URL` may be unreachable at boot time | Check database connectivity; look for `[instrumentation]` error in container logs |
| **Deepgram callback never arrives** | Recording stays in `transcribing` | Deepgram cannot POST to `NEXT_PUBLIC_APP_URL` | Switch to `TRANSCRIBE_PROVIDER=openai-whisper` for local/LAN installs; for deployed instances, ensure the URL is public HTTPS with no firewall blocking inbound POST |
| **Whisper transcription fails: "over 25MB limit"** | `failure_reason` on card reads "exceeds OpenAI's 25 MB audio file limit" | Recording longer than ~60 minutes at typical bitrate | Switch to `TRANSCRIBE_PROVIDER=deepgram` and press Retry |
| **Doctor: storage HeadBucket fails** | Red storage line | Bucket does not exist, credentials wrong, or wrong endpoint | Check `R2_BUCKET` / `S3_ENDPOINT`, verify credentials have `s3:HeadBucket` permission |

### Reading failure reasons

When a recording enters `failed` state, `media_objects.failure_reason` holds
the human-readable reason. This surfaces in three places:

- **Dashboard card** — a red "Failed" badge with the reason; **Retry** button for the owner.
- **Edit page** — the same badge in the recording status section.
- **Share page** — visitors see "This recording failed to process" without the technical reason.

The **Retry** button (owner only) re-enqueues from the correct pipeline stage:
- If no transcript exists, it re-runs transcription first (Deepgram webhook or Whisper sync).
- If a transcript exists, it skips transcription and re-runs the AI jobs (title, summary, chapters, action items, thumbnails).

### Scaling notes

Loomola is designed for single-container deployment on a single VPS.
Performance limits to be aware of:

- **pg-boss concurrency** — default team size (concurrent workers) per queue
  is 1. For high-volume instances, the queue workers are in `src/lib/queue/boss.ts`;
  increase `teamSize` if you see persistent pending backlogs and the container
  has headroom.
- **Storage costs** — Cloudflare R2 has zero egress on reads (free tier covers
  ~10 GB storage and unlimited requests). MinIO is bounded by local disk.
  Neither has per-minute costs; the per-recording cost is dominated by
  Deepgram (~$0.004/min audio) and Anthropic (~$0.01–0.05 per AI generation).
- **Memory** — the ffmpeg thumbnail and sprite jobs spike memory temporarily.
  512 MB RAM is the practical minimum; 1 GB is comfortable for concurrent
  uploads + AI jobs.
- **Multi-instance** — pg-boss is not designed for multiple processes sharing
  the same Postgres schema. Do not run multiple app containers against the same
  database without ensuring only one calls `getBoss()`. Horizontal scaling is
  not a supported configuration in v1.
