# M11 Polish + Full-Pipeline E2E Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an automated full-pipeline smoke test (`npm run smoke`) plus small production-readiness polish: env pre-flight diagnostic, noindex on share pages, normalized log prefixes, and a boot summary line.

**Architecture:** One standalone smoke script at `scripts/e2e-smoke.mjs` using existing project deps (no new installs). Two tiny helper modules (`env-check.ts`, `boot-log.ts`) wired into `src/db/index.ts`'s lazy init. Static `public/robots.txt` + `generateMetadata()` on the share page. Log prefix audit is a small grep-and-normalize pass.

**Tech Stack:** Node 22, `postgres`, `@deepgram/sdk`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `bcryptjs`, Next.js 15.

**Reference:** [M11 design spec](../specs/2026-04-24-loom-clone-m11-polish-e2e-smoke-design.md)

---

## File Structure

**New:**
- `src/lib/env-check.ts` — `checkEnv()` + `assertEnv()`
- `src/lib/boot-log.ts` — `logBootSummaryOnce()`
- `public/robots.txt` — static robots rules
- `scripts/e2e-smoke.mjs` — full-pipeline smoke script

**Modified:**
- `src/db/index.ts` — call `logBootSummaryOnce()` on first use
- `src/app/v/[slug]/page.tsx` — add `generateMetadata()` with `robots: { index: false, follow: false }`
- `package.json` — add `"smoke"` script
- A few `console.*` call-sites — normalize log prefixes
- `ROADMAP.md`, `CLAUDE.md` — mark M11 shipped + Stage 1 complete

**Retired:**
- `scripts/m6-e2e-test.mjs` — superseded by `e2e-smoke.mjs`

---

## Task 1: Env pre-flight check

**Files:**
- Create: `src/lib/env-check.ts`

- [ ] **Step 1: Implement**

Create `src/lib/env-check.ts`:
```ts
const CRITICAL_ENV_VARS = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "DEEPGRAM_API_KEY",
  "DEEPGRAM_CALLBACK_SIGNING_SECRET",
  "ANTHROPIC_API_KEY",
  "VIEW_UNLOCK_SECRET",
  "VISITOR_HASH_SALT",
  "MAILGUN_API_KEY",
  "MAILGUN_DOMAIN",
  "MAIL_FROM_ADDRESS",
  "NEXT_PUBLIC_APP_URL",
] as const;

export type EnvCheckResult =
  | { ok: true }
  | { ok: false; missing: string[] };

/**
 * Non-throwing diagnostic. Returns the list of missing critical env vars
 * at call time. Intended to be logged alongside the boot summary so the
 * operator sees one clear list instead of chasing per-var errors one at
 * a time.
 */
export function checkEnv(): EnvCheckResult {
  const missing = CRITICAL_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | grep env-check | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/env-check.ts
git commit -m "feat(m11): env pre-flight check lists missing critical vars"
```

---

## Task 2: Boot summary log + db integration

**Files:**
- Create: `src/lib/boot-log.ts`
- Modify: `src/db/index.ts`

- [ ] **Step 1: Implement boot-log**

Create `src/lib/boot-log.ts`:
```ts
import { checkEnv } from "./env-check";

let logged = false;

/**
 * Emits a one-line boot summary the first time it's called in a process.
 * Subsequent calls are no-ops. Useful for confirming a Coolify redeploy
 * picked up new Doppler secrets.
 */
export function logBootSummaryOnce(): void {
  if (logged) return;
  logged = true;
  try {
    const app = process.env.NEXT_PUBLIC_APP_URL ?? "?";
    const dbUrl = process.env.DATABASE_URL ?? "";
    const host = dbUrl.match(/@([^:/]+)/)?.[1] ?? "?";
    const bucket = process.env.R2_BUCKET_NAME ?? "?";
    const mg = process.env.MAILGUN_DOMAIN ?? "?";
    const env = checkEnv();
    const missingTag = env.ok ? "" : ` missingEnv=[${env.missing.join(",")}]`;
    console.log(
      `[boot] app=${app} db=${host} r2=${bucket} mailgun=${mg}${missingTag}`
    );
  } catch (e) {
    console.log(`[boot] summary failed: ${(e as Error).message}`);
  }
}
```

- [ ] **Step 2: Wire into db module**

Edit `src/db/index.ts`. Add the import and a call inside `getDb()`:
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { logBootSummaryOnce } from "@/lib/boot-log";

type Db = ReturnType<typeof drizzle>;

let cached: Db | undefined;

function getDb(): Db {
  if (cached) return cached;
  logBootSummaryOnce();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(connectionString, { prepare: false });
  cached = drizzle(client);
  return cached;
}

export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "boot-log|db/index" | head -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/boot-log.ts src/db/index.ts
git commit -m "feat(m11): one-shot boot summary log + env-check diagnostic"
```

---

## Task 3: robots.txt + noindex on /v/:slug

**Files:**
- Create: `public/robots.txt`
- Modify: `src/app/v/[slug]/page.tsx`

- [ ] **Step 1: Create robots.txt**

Create `public/robots.txt`:
```
User-agent: *
Disallow: /v/
Disallow: /record
Disallow: /api/
Allow: /
```

- [ ] **Step 2: Add generateMetadata to the share page**

In `src/app/v/[slug]/page.tsx`, ABOVE the default-export page function, add:
```ts
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
```

(A static `metadata` export is sufficient; we don't need per-slug variation and avoiding `generateMetadata()` saves a render call.)

- [ ] **Step 3: Build**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -10
```

Expected: "Compiled successfully" — metadata export is recognized.

- [ ] **Step 4: Commit**

```bash
git add public/robots.txt 'src/app/v/[slug]/page.tsx'
git commit -m "feat(m11): robots.txt + noindex metadata on share pages"
```

---

## Task 4: Log prefix audit

**Files:**
- Modify: a handful of `src/**` files identified via grep

- [ ] **Step 1: Grep for unprefixed console calls**

Run:
```bash
grep -rn "console\.\(log\|error\|warn\)" src/ | grep -v "\[" | grep -v "test" | head -30
```

This shows `console.*` calls that don't start with a `[prefix]`. Read through the output and note the files.

- [ ] **Step 2: Normalize each**

For each hit, edit the file to add a `[module/kind]` prefix. Examples of the pattern already in use:
- `[webhook/deepgram] transcript saved ...` — in `src/app/api/webhooks/deepgram/[recordingId]/[sig]/route.ts`
- `[pg-boss] started and workers registered (5 queues)` — in `src/lib/queue/boss.ts`
- `[transcribe] submitted Deepgram request for media ${id}` — in `src/lib/queue/jobs/transcribe.ts`
- `[title-summary] completed for ${id}: "${title}"` — in `src/lib/queue/jobs/generate-title-summary.ts`
- `[comments] mailgun notification failed: ...` — in the comments route

Rename any unprefixed `console.log("foo", ...)` to `console.log("[foo/kind] ...", ...)` matching that file's domain (upload, r2, recording, etc.).

If the grep returns zero results, this task is already done — skip to Step 4.

- [ ] **Step 3: Re-grep to confirm all clean**

Run:
```bash
grep -rn "console\.\(log\|error\|warn\)" src/ | grep -v "\[" | grep -v "test"
```

Expected: empty output.

- [ ] **Step 4: Commit (only if files changed)**

```bash
git status --short
# If any src/ files have modifications:
git add src/
git commit -m "chore(m11): normalize [module/kind] prefixes on console calls"
# If nothing modified, skip.
```

---

## Task 5: E2E smoke script

**Files:**
- Create: `scripts/e2e-smoke.mjs`
- Delete: `scripts/m6-e2e-test.mjs` (superseded)

- [ ] **Step 1: Write the smoke script**

Create `scripts/e2e-smoke.mjs`:
```js
// Full-pipeline smoke for Stage 1.
// Usage: `npm run smoke` (doppler-wrapped) or
//        `doppler run --project dissonance-cloud --config prd_loom -- node scripts/e2e-smoke.mjs`
//
// Exercises: insert media -> Deepgram -> webhook -> 4 AI jobs -> viewer HTML
// -> password gate -> unlock -> refresh-url -> comment -> trim. Cleans up.
// Note: rate limit allows ~3 runs per 5 minutes from the same public IP
// before comment POSTs start 429-ing.

import postgres from "postgres";
import bcrypt from "bcryptjs";
import { DeepgramClient } from "@deepgram/sdk";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, randomBytes } from "node:crypto";

const OWNER_ID = "612bc4b4-2a6c-4721-8820-f256e4eb0ef6";
const COMPOSITE_KEY = "iMoZLHX7CF/composite.webm";
const DURATION = 12.026;
const APP_URL = process.env.APP_URL ?? "https://loom.dissonance.cloud";
const TEST_PASSWORD = "m11-smoke-pass";

function newSlug() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const bytes = randomBytes(10);
  for (let i = 0; i < 10; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

let stepIndex = 0;
async function step(name, fn) {
  stepIndex += 1;
  const t0 = Date.now();
  try {
    const result = await fn();
    console.log(`  ✓ ${stepIndex}. ${name} (${Date.now() - t0}ms)`);
    return result;
  } catch (e) {
    console.error(`  ✗ ${stepIndex}. ${name} (${Date.now() - t0}ms): ${e.message}`);
    throw e;
  }
}

let mediaId = null;
let slug = null;
let unlockCookie = null;

async function main() {
  console.log(`[smoke] target: ${APP_URL}`);

  // Step 1: insert media_object
  await step("insert media_object", async () => {
    slug = newSlug();
    const [row] = await sql`
      INSERT INTO media_objects (owner_id, type, slug, status, duration_seconds, r2_composite_key, upload_metadata)
      VALUES (${OWNER_ID}, 'video', ${slug}, 'transcribing', ${DURATION}, ${COMPOSITE_KEY}, '{}'::jsonb)
      RETURNING id, slug
    `;
    mediaId = row.id;
  });

  // Step 2: fire Deepgram with HMAC-signed webhook
  await step("fire deepgram transcribe", async () => {
    const r2 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    const videoUrl = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: COMPOSITE_KEY }),
      { expiresIn: 3600 }
    );
    const sig = createHmac("sha256", process.env.DEEPGRAM_CALLBACK_SIGNING_SECRET)
      .update(mediaId)
      .digest("hex");
    const callbackUrl = `${APP_URL}/api/webhooks/deepgram/${mediaId}/${sig}`;
    const dg = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
    await dg.listen.v1.media.transcribeUrl({
      url: videoUrl,
      callback: callbackUrl,
      model: "nova-2",
      smart_format: true,
      language: "en",
    });
  });

  // Step 3: poll until pipeline ready
  await step("pipeline reaches status=ready (<=120s)", async () => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const [mo] = await sql`SELECT status, composite_thumbnail_key FROM media_objects WHERE id = ${mediaId}`;
      const [ao] = await sql`SELECT title_suggested, summary FROM ai_outputs WHERE media_object_id = ${mediaId}`;
      if (mo.status === "ready" && mo.composite_thumbnail_key && ao?.title_suggested && ao?.summary) {
        return;
      }
      if (mo.status === "failed") throw new Error("recording status=failed");
      await new Promise((r) => setTimeout(r, 3000));
    }
    const [mo] = await sql`SELECT status FROM media_objects WHERE id = ${mediaId}`;
    const jobs = await sql`SELECT name, state FROM pgboss.job WHERE data::text LIKE ${'%' + mediaId + '%'}`;
    throw new Error(`timeout; status=${mo?.status} jobs=${JSON.stringify(jobs)}`);
  });

  // Step 4: viewer HTML (public, no cookie)
  await step("GET /v/:slug renders viewer", async () => {
    const res = await fetch(`${APP_URL}/v/${slug}`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    for (const token of ["<video", "plyr", "Transcript"]) {
      if (!html.includes(token)) throw new Error(`missing "${token}"`);
    }
  });

  // Step 5: set password + assert gate
  await step("set password + gate renders", async () => {
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    await sql`UPDATE media_objects SET password_hash = ${hash} WHERE id = ${mediaId}`;
    const res = await fetch(`${APP_URL}/v/${slug}`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes("Password required")) throw new Error("gate not rendered");
  });

  // Step 6: unlock + capture cookie
  await step("POST /unlock sets cookie", async () => {
    const res = await fetch(`${APP_URL}/v/${slug}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = setCookie.match(new RegExp(`view_unlock_${slug}=([^;]+)`));
    if (!match) throw new Error(`no view_unlock_${slug} cookie in Set-Cookie`);
    unlockCookie = `view_unlock_${slug}=${match[1]}`;
  });

  // Step 7: refresh-url with cookie
  await step("refresh-url returns signed URL", async () => {
    const res = await fetch(`${APP_URL}/api/v/${slug}/refresh-url`, {
      method: "POST",
      headers: { cookie: unlockCookie },
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body.url || !body.url.startsWith("http")) throw new Error(`no url in body`);
  });

  // Step 8: post comment (unlocked) + assert DB row
  await step("POST /comments creates row", async () => {
    const res = await fetch(`${APP_URL}/api/v/${slug}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: unlockCookie,
      },
      body: JSON.stringify({
        name: "Smoke",
        email: "smoke@example.com",
        timestampSec: 5,
        body: "m11-smoke-test comment",
      }),
    });
    if (res.status !== 201) throw new Error(`HTTP ${res.status}`);
    const [row] = await sql`
      SELECT commenter_name, body FROM comments WHERE media_object_id = ${mediaId}
    `;
    if (!row || row.body !== "m11-smoke-test comment") {
      throw new Error(`comment not found in DB`);
    }
  });

  // Step 9: trim + assert HTML carries the values
  await step("set trim + HTML carries values", async () => {
    await sql`UPDATE media_objects SET trim_start_sec = 2, trim_end_sec = 8 WHERE id = ${mediaId}`;
    const res = await fetch(`${APP_URL}/v/${slug}`, {
      headers: { cookie: unlockCookie },
    });
    const html = await res.text();
    if (!html.includes("trimStartSec") || !html.includes("trimEndSec")) {
      throw new Error(`trim values not serialized into page`);
    }
  });
}

async function cleanup() {
  if (!mediaId) return;
  try {
    await sql`DELETE FROM media_objects WHERE id = ${mediaId}`;
    console.log(`  ✓ cleanup: deleted media_object ${mediaId}`);
  } catch (e) {
    console.error(`  ✗ cleanup failed: ${e.message}`);
  }
}

const startedAt = Date.now();
try {
  await main();
  await cleanup();
  console.log(`[smoke] all ${stepIndex} steps passed in ${Date.now() - startedAt}ms`);
  await sql.end();
  process.exit(0);
} catch (e) {
  await cleanup();
  console.error(`[smoke] FAILED after ${Date.now() - startedAt}ms: ${e.message}`);
  await sql.end();
  process.exit(1);
}
```

- [ ] **Step 2: Remove superseded M6 script**

Run:
```bash
rm scripts/m6-e2e-test.mjs
```

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-smoke.mjs
git rm scripts/m6-e2e-test.mjs
git commit -m "feat(m11): full-pipeline e2e smoke script (supersedes m6 script)"
```

---

## Task 6: Ship + live run + mark Stage 1 shipped

**Files:**
- Modify: `package.json`, `ROADMAP.md`, `CLAUDE.md`

- [ ] **Step 1: Add npm script**

Edit `package.json`. Inside the `"scripts"` block, add:
```json
"smoke": "doppler run --project dissonance-cloud --config prd_loom -- node scripts/e2e-smoke.mjs"
```

(Pick any spot in the scripts block. Order doesn't matter.)

- [ ] **Step 2: Push changes so polish is live**

Run:
```bash
git add package.json
git commit -m "chore(m11): npm run smoke script"
git push origin main
```

Wait for Coolify deploy:
```bash
until ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Status}}" | grep -q "Up [0-9]\+ seconds"'; do sleep 15; done
ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Names}} {{.Status}}"'
```

- [ ] **Step 3: Confirm boot summary shows**

After deploy, hit a non-auth route to trigger first DB use:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://loom.dissonance.cloud/v/V2LyopYmWS"
```

Then check container logs:
```bash
ssh vps 'docker logs $(docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Names}}") --tail 50 2>&1' | grep "\[boot\]"
```

Expected: one line like `[boot] app=https://loom.dissonance.cloud db=aws-1-us-east-1.pooler.supabase.com r2=loom-media mailgun=mg.dissonance.cloud`.

- [ ] **Step 4: Run the full smoke**

Run:
```bash
npm run smoke
```

Expected: 9 `✓` lines + one cleanup `✓`, final `[smoke] all 9 steps passed in NNms`, exit 0. Total time should be under ~60s (most of it is the Deepgram poll).

If any step fails, fix the underlying issue, push, redeploy, rerun. Do not mark M11 shipped until the smoke is green.

- [ ] **Step 5: Update ROADMAP.md**

Change the M11 row:
```
| M11 | Polish + full-pipeline smoke E2E | 🔄 next | Production readiness, end-to-end golden path test across the whole pipeline |
```
to:
```
| M11 | Polish + full-pipeline smoke E2E | ✅ shipped | `npm run smoke` exercises the full Stage-1 pipeline (transcribe → AI → viewer → unlock → comment → trim → cleanup); env pre-flight diagnostic + boot summary log + robots/noindex on share pages |
```

Also add a Stage-1 complete note at the top of the Status table, for instance insert between the `## Status` header and the table:
```
**Stage 1 status:** all 11 milestones shipped. Full pipeline — record → upload → transcribe → AI outputs → viewer page with password/comments/trim/downloads — is live and smoke-verified.
```

- [ ] **Step 6: Update CLAUDE.md**

Add under the existing milestone list:
```
- [x] **M11: Polish + full-pipeline smoke E2E** — `npm run smoke` runs the full pipeline via scripts/e2e-smoke.mjs; env pre-flight in src/lib/env-check.ts; boot summary in src/lib/boot-log.ts (hooked via src/db/index.ts); robots.txt + noindex meta on /v/:slug; log prefixes normalized.

**Stage 1 complete.** Every feature outlined in the design spec (docs/superpowers/specs/2026-04-22-loom-clone-design.md) is live at https://loom.dissonance.cloud and covered by the smoke script.
```

- [ ] **Step 7: Commit + push**

```bash
git add ROADMAP.md CLAUDE.md
git commit -m "chore(m11): mark Stage 1 complete"
git push origin main
```

---

## Self-Review Notes

- Spec coverage:
  - Smoke script with step() helper + cleanup → Task 5.
  - `env-check` utility + critical var list → Task 1.
  - Boot summary + db-module hook → Task 2.
  - `robots.txt` + noindex metadata → Task 3.
  - Log prefix audit → Task 4 (may be no-op if nothing's unprefixed).
  - `npm run smoke` package script → Task 6.
  - Live run before marking shipped → Task 6 Step 4.

- Types are consistent:
  - `EnvCheckResult = { ok: true } | { ok: false; missing: string[] }` — used in Tasks 1 and 2.
  - `logBootSummaryOnce(): void` — single call signature from Task 2 onward.
  - Smoke script `step(name, fn)` — internally consistent.
  - `mediaId` / `slug` / `unlockCookie` — script-level state variables threaded through steps.

- Risk mitigations from the spec:
  - Rate limit interaction on multiple smoke runs → documented at top of the script (Task 5 file header).
  - Deepgram cost (~$0.01/run) → not mitigated; acceptable.
  - Boot log printing DB host → acceptable (stdout only, not leaked externally).

- Stage 1 closure — after Task 6, ROADMAP + CLAUDE both explicitly state "Stage 1 complete", which is the real ship signal.
