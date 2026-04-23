# M8 Password Protect + View Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate password-protected recordings with a bcrypt unlock flow, and track anonymous views + per-viewer progress with a drop-off chart visible to the creator.

**Architecture:** Three pure server utilities (HMAC-signed cookies, visitor hashing, drop-off bucketizing) + a thin DB query module for views. Five API routes (unlock, password PUT/DELETE, view, progress) plus a modified `refresh-url` that enforces unlock cookies. Four client components (PasswordGate, OwnerToolbar, Tracking, DropoffChart) wired into the existing ViewerShell. Views table already exists; we add one unique index for upsert.

**Tech Stack:** Next.js 15 App Router, React 19, bcryptjs, drizzle-kit migrations, Tailwind, Vitest.

**Reference:** [M8 design spec](../specs/2026-04-23-loom-clone-m8-password-views-design.md)

---

## File Structure

**New:**
- `src/lib/viewer/unlock-cookie.ts` — HMAC sign/verify for slug-scoped unlock tokens
- `src/lib/viewer/visitor-id.ts` — SHA-256 over `IP + UA-summary + salt`
- `src/lib/viewer/dropoff.ts` — pure `bucketize(maxList, durationSec, bucketCount)`
- `src/db/queries/views.ts` — upsert, progress update, count + listMaxWatched + listViewCounts
- `src/app/v/[slug]/unlock/route.ts` — POST unlock form handler
- `src/app/api/v/[slug]/view/route.ts` — POST first-view recorder
- `src/app/api/v/[slug]/progress/route.ts` — POST progress beacon handler
- `src/app/api/recordings/[id]/password/route.ts` — owner-only PUT + DELETE
- `src/components/viewer/password-gate.tsx` — viewer unlock form
- `src/components/viewer/owner-toolbar.tsx` — owner password toggle + popover
- `src/components/viewer/tracking.tsx` — fires view + progress POSTs
- `src/components/viewer/dropoff-chart.tsx` — 10-bar CSS histogram
- `tests/unit/unlock-cookie.test.ts`
- `tests/unit/visitor-id.test.ts`
- `tests/unit/dropoff-bucketize.test.ts`

**Modified:**
- `package.json`, `package-lock.json` — `bcryptjs` + `@types/bcryptjs`
- `src/db/schema.ts` — add unique index on `views.(media_object_id, viewer_ip_hash)`
- `drizzle/0003_*.sql` — generated migration
- `src/app/api/v/[slug]/refresh-url/route.ts` — enforce unlock cookie when password set
- `src/app/v/[slug]/page.tsx` — password-gate branch, owner toolbar, dropoff chart, pass `isOwner` to shell
- `src/components/viewer/viewer-shell.tsx` — emit play-state, render `<Tracking>` when `!isOwner`
- `src/components/viewer/video-player.tsx` — wire Plyr `play` / `pause` / `ended` events up to shell
- `src/db/queries/recordings.ts` — add `viewCount` to `RecordingWithBrand` + `listRecordings` query
- `src/components/dashboard/recording-card.tsx` — render view count

---

## Task 1: Install bcryptjs

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

Run:
```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

Expected: `bcryptjs` added to `dependencies`, `@types/bcryptjs` to `devDependencies`.

- [ ] **Step 2: Verify**

Run:
```bash
node -e 'console.log(require.resolve("bcryptjs"))'
```

Expected: prints a path inside `node_modules/bcryptjs`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(m8): add bcryptjs for per-video password hashing"
```

---

## Task 2: Unique index on views

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0003_*.sql` (generated)

- [ ] **Step 1: Add the unique index to the schema**

In `src/db/schema.ts`, find the `views` table definition (around the `export const views = pgTable("views", { ... })` block). Add a second-argument table builder that declares the unique index. The final shape should look like:

```ts
export const views = pgTable(
  "views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    viewerIpHash: text("viewer_ip_hash").notNull(),
    viewerCountry: text("viewer_country"),
    watchedSeconds: numeric("watched_seconds").default("0"),
    maxWatchedSec: numeric("max_watched_sec").default("0"),
    userAgentSummary: text("user_agent_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqMediaVisitor: uniqueIndex("views_media_visitor_uq").on(
      t.mediaObjectId,
      t.viewerIpHash
    ),
  })
);
```

Add `uniqueIndex` to the import line at the top of the file:
```ts
import { pgTable, uuid, text, numeric, timestamp, jsonb, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
```
(Keep whatever imports were already there; just make sure `uniqueIndex` is present.)

- [ ] **Step 2: Generate the migration**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npx drizzle-kit generate
```

Expected: prints `Changes applied` or similar and creates `drizzle/0003_<random>.sql`. Open the file and confirm it contains:
```sql
CREATE UNIQUE INDEX "views_media_visitor_uq" ON "views" USING btree ("media_object_id","viewer_ip_hash");
```

- [ ] **Step 3: Apply migration to prod DB**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npx tsx scripts/migrate.ts
```

Expected: prints `migrations applied` (or equivalent). If migrate.ts needs a different invocation, check `scripts/migrate.ts` top comment.

- [ ] **Step 4: Verify the index exists**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
(async () => {
  const r = await sql`SELECT indexname FROM pg_indexes WHERE tablename = '"'"'views'"'"'`;
  console.log(r.map(x => x.indexname).join(","));
  await sql.end();
})();
'
```

Expected: output includes `views_media_visitor_uq`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/0003_*.sql
git commit -m "feat(m8): unique index on views(media_object_id, viewer_ip_hash) for upsert"
```

---

## Task 3: unlock-cookie utility (TDD)

**Files:**
- Create: `src/lib/viewer/unlock-cookie.ts`
- Create: `tests/unit/unlock-cookie.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/unlock-cookie.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import {
  signUnlockToken,
  verifyUnlockToken,
  cookieName,
} from "@/lib/viewer/unlock-cookie";

beforeAll(() => {
  process.env.VIEW_UNLOCK_SECRET = "a".repeat(64);
});

describe("cookieName", () => {
  it("prefixes with view_unlock_", () => {
    expect(cookieName("abc123")).toBe("view_unlock_abc123");
  });
});

describe("signUnlockToken / verifyUnlockToken", () => {
  const slug = "V2LyopYmWS";
  const passwordHash = "$2a$10$abcdefghijklmnopqrstuv";

  it("produces a deterministic hex token", () => {
    const t1 = signUnlockToken({ slug, passwordHash });
    const t2 = signUnlockToken({ slug, passwordHash });
    expect(t1).toBe(t2);
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts its own output", () => {
    const token = signUnlockToken({ slug, passwordHash });
    expect(verifyUnlockToken({ slug, passwordHash, token })).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = signUnlockToken({ slug, passwordHash });
    const bad = "0".repeat(token.length);
    expect(verifyUnlockToken({ slug, passwordHash, token: bad })).toBe(false);
  });

  it("rejects the token after password hash changes", () => {
    const token = signUnlockToken({ slug, passwordHash });
    const newHash = "$2a$10$differentdifferentdifferentdif";
    expect(
      verifyUnlockToken({ slug, passwordHash: newHash, token })
    ).toBe(false);
  });

  it("returns false when passwordHash is null (no password set)", () => {
    const token = signUnlockToken({ slug, passwordHash });
    expect(
      verifyUnlockToken({ slug, passwordHash: null, token })
    ).toBe(false);
  });

  it("returns false on empty token", () => {
    expect(verifyUnlockToken({ slug, passwordHash, token: "" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
npx vitest run tests/unit/unlock-cookie.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/viewer/unlock-cookie'".

- [ ] **Step 3: Implement**

Create `src/lib/viewer/unlock-cookie.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const s = process.env.VIEW_UNLOCK_SECRET;
  if (!s) throw new Error("VIEW_UNLOCK_SECRET is not set");
  return s;
}

export function cookieName(slug: string): string {
  return `view_unlock_${slug}`;
}

/**
 * Signs a slug+password-hash pair into a hex HMAC. The password hash is in
 * the signing path so that changing the password implicitly invalidates all
 * outstanding unlock cookies.
 */
export function signUnlockToken({
  slug,
  passwordHash,
}: {
  slug: string;
  passwordHash: string;
}): string {
  return createHmac("sha256", getSecret())
    .update(`${slug}:${passwordHash}`)
    .digest("hex");
}

/**
 * Constant-time HMAC compare. Returns false when passwordHash is null (no
 * password is currently set — any cookie should be considered stale) or on
 * any length/parse mismatch.
 */
export function verifyUnlockToken({
  slug,
  passwordHash,
  token,
}: {
  slug: string;
  passwordHash: string | null;
  token: string;
}): boolean {
  if (!passwordHash || !token) return false;
  const expected = signUnlockToken({ slug, passwordHash });
  if (expected.length !== token.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(token, "hex")
    );
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
npx vitest run tests/unit/unlock-cookie.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewer/unlock-cookie.ts tests/unit/unlock-cookie.test.ts
git commit -m "feat(m8): HMAC unlock-cookie utility scoped by slug + password hash"
```

---

## Task 4: visitor-id utility (TDD)

**Files:**
- Create: `src/lib/viewer/visitor-id.ts`
- Create: `tests/unit/visitor-id.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/visitor-id.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { hashVisitor } from "@/lib/viewer/visitor-id";

beforeAll(() => {
  process.env.VISITOR_HASH_SALT = "b".repeat(64);
});

function req(ip: string | null, ua: string | null): Request {
  const headers = new Headers();
  if (ip) headers.set("x-forwarded-for", ip);
  if (ua) headers.set("user-agent", ua);
  return new Request("http://example.com/", { headers });
}

describe("hashVisitor", () => {
  it("returns a 64-char hex digest", () => {
    expect(hashVisitor(req("1.2.3.4", "Chrome/130"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same inputs", () => {
    const a = hashVisitor(req("1.2.3.4", "Chrome/130"));
    const b = hashVisitor(req("1.2.3.4", "Chrome/130"));
    expect(a).toBe(b);
  });

  it("differs when IP changes", () => {
    const a = hashVisitor(req("1.2.3.4", "Chrome/130"));
    const b = hashVisitor(req("9.9.9.9", "Chrome/130"));
    expect(a).not.toBe(b);
  });

  it("differs when UA changes", () => {
    const a = hashVisitor(req("1.2.3.4", "Chrome/130"));
    const b = hashVisitor(req("1.2.3.4", "Firefox/120"));
    expect(a).not.toBe(b);
  });

  it("returns a stable hash when IP and UA are absent", () => {
    const a = hashVisitor(req(null, null));
    const b = hashVisitor(req(null, null));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("takes the first IP from a comma-separated forwarded-for list", () => {
    const a = hashVisitor(req("1.2.3.4, 5.6.7.8", "Chrome/130"));
    const b = hashVisitor(req("1.2.3.4", "Chrome/130"));
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
npx vitest run tests/unit/visitor-id.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/viewer/visitor-id'".

- [ ] **Step 3: Implement**

Create `src/lib/viewer/visitor-id.ts`:
```ts
import { createHash } from "node:crypto";

function getSalt(): string {
  const s = process.env.VISITOR_HASH_SALT;
  if (!s) throw new Error("VISITOR_HASH_SALT is not set");
  return s;
}

/**
 * Derives a stable anonymous visitor id from the request's IP and User-Agent.
 * Uses the first address from X-Forwarded-For (falls back to X-Real-IP, then
 * empty string). User-Agent is truncated to 64 chars to keep the hash input
 * bounded and reduce churn from long UA strings.
 */
export function hashVisitor(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const xri = request.headers.get("x-real-ip") ?? "";
  const ipRaw = xff.split(",")[0]?.trim() || xri.trim() || "";
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 64);

  return createHash("sha256")
    .update(`${ipRaw}\n${ua}\n${getSalt()}`)
    .digest("hex");
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
npx vitest run tests/unit/visitor-id.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewer/visitor-id.ts tests/unit/visitor-id.test.ts
git commit -m "feat(m8): anonymous visitor hash from IP + UA + salt"
```

---

## Task 5: dropoff bucketize (TDD)

**Files:**
- Create: `src/lib/viewer/dropoff.ts`
- Create: `tests/unit/dropoff-bucketize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/dropoff-bucketize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { bucketize } from "@/lib/viewer/dropoff";

describe("bucketize", () => {
  it("returns an array of zeros for no viewers", () => {
    expect(bucketize([], 60)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("places a single viewer at the exact half-mark in bucket 5", () => {
    const buckets = bucketize([30], 60);
    expect(buckets[5]).toBe(1);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("places a viewer at 0 seconds in bucket 0", () => {
    expect(bucketize([0], 60)[0]).toBe(1);
  });

  it("clamps a viewer who watched longer than the duration to the last bucket", () => {
    const buckets = bucketize([9999], 60);
    expect(buckets[9]).toBe(1);
  });

  it("groups many viewers correctly", () => {
    const buckets = bucketize([5, 5, 15, 25, 25, 25, 60], 60);
    expect(buckets[0]).toBe(2);
    expect(buckets[2]).toBe(1);
    expect(buckets[4]).toBe(3);
    expect(buckets[9]).toBe(1);
  });

  it("respects a custom bucket count", () => {
    const buckets = bucketize([30], 60, 4);
    expect(buckets).toHaveLength(4);
    expect(buckets[2]).toBe(1);
  });

  it("returns all zeros when duration is 0 (defensive)", () => {
    expect(bucketize([10], 0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
npx vitest run tests/unit/dropoff-bucketize.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/viewer/dropoff'".

- [ ] **Step 3: Implement**

Create `src/lib/viewer/dropoff.ts`:
```ts
/**
 * Buckets a list of per-viewer `max_watched_sec` values into `bucketCount`
 * equal-width bins covering `[0, durationSec]`. Viewers who exceed the
 * duration clamp to the last bucket. Returns an array of counts with length
 * `bucketCount`.
 */
export function bucketize(
  maxWatchedPerViewer: number[],
  durationSec: number,
  bucketCount = 10
): number[] {
  const buckets = new Array<number>(bucketCount).fill(0);
  if (durationSec <= 0) return buckets;
  const width = durationSec / bucketCount;
  for (const max of maxWatchedPerViewer) {
    const raw = Math.floor(max / width);
    const idx = Math.max(0, Math.min(bucketCount - 1, raw));
    buckets[idx] += 1;
  }
  return buckets;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
npx vitest run tests/unit/dropoff-bucketize.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewer/dropoff.ts tests/unit/dropoff-bucketize.test.ts
git commit -m "feat(m8): pure dropoff bucketize helper"
```

---

## Task 6: views queries module

**Files:**
- Create: `src/db/queries/views.ts`

- [ ] **Step 1: Implement**

Create `src/db/queries/views.ts`:
```ts
import { db } from "@/db";
import { views } from "@/db/schema";
import { eq, sql, inArray, and } from "drizzle-orm";

/**
 * Upsert a view row. If the (media_object_id, visitor_hash) pair already
 * exists, bumps `updated_at`; otherwise inserts a fresh row with the given
 * user-agent summary.
 */
export async function upsertView(params: {
  mediaObjectId: string;
  visitorHash: string;
  userAgentSummary: string;
}): Promise<void> {
  await db
    .insert(views)
    .values({
      mediaObjectId: params.mediaObjectId,
      viewerIpHash: params.visitorHash,
      userAgentSummary: params.userAgentSummary,
    })
    .onConflictDoUpdate({
      target: [views.mediaObjectId, views.viewerIpHash],
      set: { updatedAt: sql`now()` },
    });
}

/**
 * Lazily creates the view row (with empty UA summary) if missing, then
 * updates max_watched_sec (only raising it) and increments watched_seconds
 * by 5 — one beacon pulse's worth of time.
 */
export async function updateProgress(params: {
  mediaObjectId: string;
  visitorHash: string;
  currentTimeSec: number;
}): Promise<void> {
  await db
    .insert(views)
    .values({
      mediaObjectId: params.mediaObjectId,
      viewerIpHash: params.visitorHash,
      maxWatchedSec: String(params.currentTimeSec),
      watchedSeconds: "5",
    })
    .onConflictDoUpdate({
      target: [views.mediaObjectId, views.viewerIpHash],
      set: {
        maxWatchedSec: sql`GREATEST(${views.maxWatchedSec}, ${String(params.currentTimeSec)}::numeric)`,
        watchedSeconds: sql`${views.watchedSeconds} + 5`,
        updatedAt: sql`now()`,
      },
    });
}

export async function countViews(mediaObjectId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(views)
    .where(eq(views.mediaObjectId, mediaObjectId));
  return row?.c ?? 0;
}

export async function listViewCounts(
  mediaObjectIds: string[]
): Promise<Record<string, number>> {
  if (mediaObjectIds.length === 0) return {};
  const rows = await db
    .select({
      mediaObjectId: views.mediaObjectId,
      c: sql<number>`count(*)::int`,
    })
    .from(views)
    .where(inArray(views.mediaObjectId, mediaObjectIds))
    .groupBy(views.mediaObjectId);
  const map: Record<string, number> = {};
  for (const r of rows) map[r.mediaObjectId] = r.c;
  return map;
}

/**
 * Returns the per-viewer max_watched_sec for a single recording, as an
 * array of numbers. Used as the input to `bucketize()`.
 */
export async function listMaxWatched(
  mediaObjectId: string
): Promise<number[]> {
  const rows = await db
    .select({ m: views.maxWatchedSec })
    .from(views)
    .where(eq(views.mediaObjectId, mediaObjectId));
  return rows.map((r) => parseFloat(String(r.m ?? "0")));
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -20
```

Expected: no errors in `src/db/queries/views.ts`. (Ignore any pre-existing errors elsewhere.)

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/views.ts
git commit -m "feat(m8): views query module (upsert, progress, counts, maxWatched)"
```

---

## Task 7: Password API (PUT + DELETE)

**Files:**
- Create: `src/app/api/recordings/[id]/password/route.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/recordings/[id]/password/route.ts`:
```ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/lib/require-auth";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json()) as { password?: string };
  const password = (body.password ?? "").trim();
  if (password.length < 4) {
    return NextResponse.json(
      { error: "password_too_short" },
      { status: 400 }
    );
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await db
    .update(mediaObjects)
    .set({ passwordHash: hash })
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, user.id)))
    .returning({ id: mediaObjects.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const result = await db
    .update(mediaObjects)
    .set({ passwordHash: null })
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, user.id)))
    .returning({ id: mediaObjects.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -20
```

Expected: no errors in this new file.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/api/recordings/[id]/password/route.ts'
git commit -m "feat(m8): owner-only PUT/DELETE /api/recordings/:id/password"
```

---

## Task 8: Unlock route + refresh-url enforcement

**Files:**
- Create: `src/app/v/[slug]/unlock/route.ts`
- Modify: `src/app/api/v/[slug]/refresh-url/route.ts`

- [ ] **Step 1: Implement the unlock route**

Create `src/app/v/[slug]/unlock/route.ts`:
```ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { cookieName, signUnlockToken } from "@/lib/viewer/unlock-cookie";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    password?: string;
  };
  const password = body.password ?? "";
  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!rec.passwordHash) {
    return NextResponse.json({ ok: true });
  }
  const ok = await bcrypt.compare(password, rec.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "bad_password" }, { status: 401 });
  }
  const token = signUnlockToken({ slug, passwordHash: rec.passwordHash });
  const jar = await cookies();
  jar.set(cookieName(slug), token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return NextResponse.json({ ok: true });
}
```

Note: `RecordingWithBrand` doesn't currently surface `passwordHash`. The type extends `Recording = typeof mediaObjects.$inferSelect`, which includes `passwordHash`, so `rec.passwordHash` should already typecheck. Verify with:
```bash
grep -n "password" src/db/queries/recordings.ts
```
It should show no hits (the spread `...row.rec` already carries it).

- [ ] **Step 2: Modify refresh-url to enforce the unlock cookie**

Edit `src/app/api/v/[slug]/refresh-url/route.ts`. Replace the entire body with:
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { presignGet } from "@/lib/r2/presigned-get";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (rec.status !== "ready" || !rec.r2CompositeKey) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }
  if (rec.passwordHash) {
    const jar = await cookies();
    const token = jar.get(cookieName(slug))?.value ?? "";
    if (!verifyUnlockToken({ slug, passwordHash: rec.passwordHash, token })) {
      return NextResponse.json({ error: "locked" }, { status: 403 });
    }
  }
  const url = await presignGet(rec.r2CompositeKey);
  return NextResponse.json({ url });
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -20
```

Expected: no errors in either file.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/v/[slug]/unlock/route.ts' 'src/app/api/v/[slug]/refresh-url/route.ts'
git commit -m "feat(m8): POST /v/:slug/unlock + refresh-url enforces unlock cookie"
```

---

## Task 9: View + progress API routes

**Files:**
- Create: `src/app/api/v/[slug]/view/route.ts`
- Create: `src/app/api/v/[slug]/progress/route.ts`

- [ ] **Step 1: Implement the view route**

Create `src/app/api/v/[slug]/view/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { upsertView } from "@/db/queries/views";
import { hashVisitor } from "@/lib/viewer/visitor-id";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const visitorHash = hashVisitor(request);
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 120);
  await upsertView({
    mediaObjectId: rec.id,
    visitorHash,
    userAgentSummary: ua,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implement the progress route**

Create `src/app/api/v/[slug]/progress/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { updateProgress } from "@/db/queries/views";
import { hashVisitor } from "@/lib/viewer/visitor-id";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as { t?: number };
  const t = typeof body.t === "number" && isFinite(body.t) && body.t >= 0
    ? body.t
    : 0;
  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const visitorHash = hashVisitor(request);
  await updateProgress({
    mediaObjectId: rec.id,
    visitorHash,
    currentTimeSec: t,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -20
```

Expected: no errors in either new file.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/api/v/[slug]/view/route.ts' 'src/app/api/v/[slug]/progress/route.ts'
git commit -m "feat(m8): POST /api/v/:slug/view + /api/v/:slug/progress tracking"
```

---

## Task 10: Password UI — gate + owner toolbar

**Files:**
- Create: `src/components/viewer/password-gate.tsx`
- Create: `src/components/viewer/owner-toolbar.tsx`

- [ ] **Step 1: Implement PasswordGate**

Create `src/components/viewer/password-gate.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PasswordGate({ slug }: { slug: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/v/${slug}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setError("Incorrect password.");
        return;
      }
      if (!res.ok) {
        setError(`Unexpected error (${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-sm rounded-lg border border-white/10 p-6">
      <h2 className="text-lg font-semibold">Password required</h2>
      <p className="mt-1 text-sm opacity-60">
        Enter the password to view this recording.
      </p>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-sm"
          placeholder="Password"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className="w-full rounded bg-white/20 px-3 py-2 text-sm font-medium hover:bg-white/30 disabled:opacity-50"
        >
          {submitting ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Implement OwnerToolbar**

Create `src/components/viewer/owner-toolbar.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OwnerToolbar({
  recordingId,
  hasPassword,
}: {
  recordingId: string;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePassword() {
    if (password.length < 4) {
      setError("Use at least 4 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/password`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(`Save failed (${res.status}).`);
        return;
      }
      setOpen(false);
      setPassword("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removePassword() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/password`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`Remove failed (${res.status}).`);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-white/10 p-3 text-sm">
      <span className="opacity-60">Password:</span>
      <span className={hasPassword ? "text-emerald-300" : "opacity-70"}>
        {hasPassword ? "on" : "off"}
      </span>
      <button
        onClick={() => {
          setOpen(!open);
          setError(null);
        }}
        className="ml-auto rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
      >
        {hasPassword ? "Change" : "Add password"}
      </button>
      {hasPassword && (
        <button
          onClick={removePassword}
          disabled={busy}
          className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-200 hover:bg-red-500/30 disabled:opacity-50"
        >
          Remove
        </button>
      )}
      {open && (
        <div className="ml-2 flex w-full items-center gap-2 border-t border-white/10 pt-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasPassword ? "New password" : "Password"}
            className="flex-1 rounded border border-white/20 bg-white/5 px-2 py-1 text-sm"
          />
          <button
            onClick={savePassword}
            disabled={busy}
            className="rounded bg-white/20 px-2 py-1 text-xs hover:bg-white/30 disabled:opacity-50"
          >
            Save
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/viewer/password-gate.tsx src/components/viewer/owner-toolbar.tsx
git commit -m "feat(m8): PasswordGate + OwnerToolbar client components"
```

---

## Task 11: Tracking component + ViewerShell wiring

**Files:**
- Create: `src/components/viewer/tracking.tsx`
- Modify: `src/components/viewer/video-player.tsx`
- Modify: `src/components/viewer/viewer-shell.tsx`

- [ ] **Step 1: Implement Tracking**

Create `src/components/viewer/tracking.tsx`:
```tsx
"use client";

import { useEffect, useRef } from "react";

type Props = {
  slug: string;
  isPlaying: boolean;
  getCurrentTime: () => number;
};

export function Tracking({ slug, isPlaying, getCurrentTime }: Props) {
  const firedFirstView = useRef(false);

  useEffect(() => {
    if (!isPlaying) return;
    if (!firedFirstView.current) {
      firedFirstView.current = true;
      void fetch(`/api/v/${slug}/view`, { method: "POST", keepalive: true });
    }
    const id = setInterval(() => {
      const t = getCurrentTime();
      const body = JSON.stringify({ t });
      const blob = new Blob([body], { type: "application/json" });
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/v/${slug}/progress`, blob);
      } else {
        void fetch(`/api/v/${slug}/progress`, {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
          keepalive: true,
        });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [isPlaying, slug, getCurrentTime]);

  return null;
}
```

- [ ] **Step 2: Wire play-state out of VideoPlayer**

Edit `src/components/viewer/video-player.tsx`. Two changes:

(a) Add `onPlayStateChange` to the `Props` type. The updated `Props` type should read:
```ts
type Props = {
  slug: string;
  initialSignedUrl: string;
  chapters: Chapter[];
  accentColor: string;
  onTimeUpdate: (sec: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
};
```

(b) Add the new prop to the destructuring in the forwardRef function signature and hook Plyr events. Replace the `plyrRef.current.on("timeupdate", ...)` block with:
```ts
      plyrRef.current.on("timeupdate", () => {
        onTimeUpdate(plyrRef.current?.currentTime ?? 0);
      });
      plyrRef.current.on("play", () => onPlayStateChange?.(true));
      plyrRef.current.on("pause", () => onPlayStateChange?.(false));
      plyrRef.current.on("ended", () => onPlayStateChange?.(false));
```

The function signature update should read:
```tsx
export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { slug, initialSignedUrl, chapters, accentColor, onTimeUpdate, onPlayStateChange },
  ref
) {
```

Everything else in that file stays the same.

- [ ] **Step 3: Wire Tracking into ViewerShell**

Edit `src/components/viewer/viewer-shell.tsx`. Rewrite the file as:
```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import { ChaptersList } from "./chapters-list";
import { ActionItemsList } from "./action-items-list";
import { Tracking } from "./tracking";
import type { Word } from "@/lib/viewer/paragraphs";

export type ViewerShellProps = {
  slug: string;
  signedVideoUrl: string;
  accentColor: string;
  chapters: Array<{ start_sec: number; title: string }>;
  actionItems: Array<{ timestamp_sec: number; text: string }>;
  words: Word[];
  fullText: string;
  isOwner: boolean;
};

export function ViewerShell({
  slug,
  signedVideoUrl,
  accentColor,
  chapters,
  actionItems,
  words,
  fullText,
  isOwner,
}: ViewerShellProps) {
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleSeek = useCallback((sec: number) => {
    playerRef.current?.seek(sec);
  }, []);

  const getCurrentTime = useCallback(() => {
    return playerRef.current?.getCurrentTime() ?? 0;
  }, []);

  return (
    <div>
      <VideoPlayer
        ref={playerRef}
        slug={slug}
        initialSignedUrl={signedVideoUrl}
        chapters={chapters}
        accentColor={accentColor}
        onTimeUpdate={setCurrentTime}
        onPlayStateChange={setIsPlaying}
      />
      {!isOwner && (
        <Tracking
          slug={slug}
          isPlaying={isPlaying}
          getCurrentTime={getCurrentTime}
        />
      )}
      <TranscriptPanel
        words={words}
        fullText={fullText}
        currentTime={currentTime}
        onSeek={handleSeek}
      />
      <ChaptersList chapters={chapters} onSeek={handleSeek} />
      <ActionItemsList actionItems={actionItems} onSeek={handleSeek} />
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/tracking.tsx src/components/viewer/video-player.tsx src/components/viewer/viewer-shell.tsx
git commit -m "feat(m8): Tracking component + shell wiring for play-state + owner skip"
```

---

## Task 12: DropoffChart component

**Files:**
- Create: `src/components/viewer/dropoff-chart.tsx`

- [ ] **Step 1: Implement**

Create `src/components/viewer/dropoff-chart.tsx`:
```tsx
export function DropoffChart({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets);
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <div className="mt-8">
        <h2 className="text-sm font-medium">Viewer drop-off</h2>
        <p className="mt-2 text-xs opacity-60">No views yet.</p>
      </div>
    );
  }
  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium">
        Viewer drop-off <span className="opacity-60">({total} views)</span>
      </h2>
      <div className="mt-3 flex h-20 items-end gap-1 rounded border border-white/10 p-2">
        {buckets.map((count, i) => {
          const pct = Math.round((count / max) * 100);
          return (
            <div
              key={i}
              className="flex-1 rounded bg-emerald-400/60"
              style={{ height: `${Math.max(pct, 2)}%` }}
              title={`Bucket ${i + 1}/${buckets.length}: ${count} viewers`}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs opacity-60">
        Each bar covers {100 / buckets.length}% of the recording's duration.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/viewer/dropoff-chart.tsx
git commit -m "feat(m8): DropoffChart CSS bar histogram"
```

---

## Task 13: Page integration (gate + toolbar + dropoff + isOwner passdown)

**Files:**
- Modify: `src/app/v/[slug]/page.tsx`

- [ ] **Step 1: Replace the page file**

Overwrite `src/app/v/[slug]/page.tsx` with:
```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { listMaxWatched, countViews } from "@/db/queries/views";
import { presignGet } from "@/lib/r2/presigned-get";
import { CopyLinkButton } from "@/components/share/copy-link-button";
import { ViewerShell } from "@/components/viewer/viewer-shell";
import { PasswordGate } from "@/components/viewer/password-gate";
import { OwnerToolbar } from "@/components/viewer/owner-toolbar";
import { DropoffChart } from "@/components/viewer/dropoff-chart";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import { bucketize } from "@/lib/viewer/dropoff";
import type { Word } from "@/lib/viewer/paragraphs";

export default async function SharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);
  if (!rec) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isOwner = !!user && user.id === rec.ownerId;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const shareUrl = `${appUrl}/v/${slug}`;
  const accent = rec.brand?.accentColor ?? "#4F46E5";

  // Password gate: if password set and visitor isn't owner and cookie invalid,
  // render just the gate. Owner bypasses the gate.
  let unlocked = true;
  if (rec.passwordHash && !isOwner) {
    const jar = await cookies();
    const token = jar.get(cookieName(slug))?.value ?? "";
    unlocked = verifyUnlockToken({
      slug,
      passwordHash: rec.passwordHash,
      token,
    });
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen">
        <header
          className="flex items-center justify-between border-b border-white/10 px-6 py-3"
          style={{ borderBottomColor: accent }}
        />
        <PasswordGate slug={slug} />
      </div>
    );
  }

  const transcript = await getTranscriptByRecording(rec.id);
  const words: Word[] = Array.isArray(transcript?.wordTimestamps)
    ? (transcript.wordTimestamps as Word[])
    : [];

  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const signedVideoUrl = isReady ? await presignGet(rec.r2CompositeKey!) : null;

  // Owner-only analytics
  let dropoffBuckets: number[] | null = null;
  let viewCount = 0;
  if (isOwner && isReady) {
    const durationSec = parseFloat(String(rec.durationSeconds ?? "0"));
    const maxList = await listMaxWatched(rec.id);
    dropoffBuckets = bucketize(maxList, durationSec, 10);
    viewCount = await countViews(rec.id);
  }

  return (
    <div className="min-h-screen">
      <header
        className="flex items-center justify-between border-b border-white/10 px-6 py-3"
        style={{ borderBottomColor: accent }}
      >
        <div className="flex items-center gap-3">
          {rec.brand?.logoUrl && (
            <img
              src={rec.brand.logoUrl}
              alt={rec.brand.name}
              className="h-6 w-auto"
            />
          )}
          {rec.brand?.name && (
            <span className="text-sm font-semibold">{rec.brand.name}</span>
          )}
        </div>
        {isOwner && (
          <Link href="/" className="text-xs opacity-60 hover:opacity-100">
            Back to dashboard
          </Link>
        )}
      </header>

      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">{displayTitle}</h1>
        <p className="mt-1 text-sm opacity-60">
          {isReady ? "Ready" : `Status: ${rec.status}`}
          {isOwner && isReady && viewCount > 0 && (
            <> · {viewCount} view{viewCount === 1 ? "" : "s"}</>
          )}
        </p>

        {rec.aiSummary && (
          <p className="mt-4 text-sm leading-relaxed opacity-80">{rec.aiSummary}</p>
        )}

        {isOwner && (
          <OwnerToolbar
            recordingId={rec.id}
            hasPassword={!!rec.passwordHash}
          />
        )}

        {isReady && signedVideoUrl ? (
          <div className="mt-6">
            <ViewerShell
              slug={slug}
              signedVideoUrl={signedVideoUrl}
              accentColor={accent}
              chapters={rec.aiChapters ?? []}
              actionItems={rec.aiActionItems ?? []}
              words={words}
              fullText={transcript?.fullText ?? ""}
              isOwner={isOwner}
            />
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-white/10 p-8 text-center">
            <p className="text-lg">
              {rec.status === "transcribing"
                ? "Transcription in progress"
                : rec.status === "processing"
                  ? "AI outputs generating"
                  : rec.status === "uploading"
                    ? "Uploading"
                    : "Not ready"}
            </p>
            <p className="mt-2 text-sm opacity-60">
              Refresh in ~15–30 seconds.
            </p>
          </div>
        )}

        {isOwner && dropoffBuckets && <DropoffChart buckets={dropoffBuckets} />}

        <div className="mt-6 flex items-center gap-3 rounded-lg border border-white/10 p-4">
          <code className="flex-1 truncate rounded bg-white/5 px-3 py-2 text-sm">
            {shareUrl}
          </code>
          <CopyLinkButton url={shareUrl} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to catch type errors**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -30
```

Expected: "Compiled successfully" and no type errors.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/v/[slug]/page.tsx'
git commit -m "feat(m8): page integration — gate + owner toolbar + dropoff chart"
```

---

## Task 14: Dashboard view count

**Files:**
- Modify: `src/db/queries/recordings.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/components/dashboard/recording-card.tsx`

- [ ] **Step 1: Extend `RecordingWithBrand` with viewCount**

Edit `src/db/queries/recordings.ts`. Update the type:
```ts
export type RecordingWithBrand = Recording & {
  brand: { id: string; name: string; accentColor: string; logoUrl: string | null } | null;
  aiTitle: string | null;
  aiSummary: string | null;
  aiChapters: Array<{ start_sec: number; title: string }> | null;
  aiActionItems: Array<{ text: string; timestamp_sec: number }> | null;
  viewCount: number;
};
```

In `listRecordings`, after computing `rows`, compute view counts in batch and add them to the mapping. Replace the `return rows.map((r) => ({ ... }));` block with:
```ts
  const { listViewCounts } = await import("@/db/queries/views");
  const counts = await listViewCounts(rows.map((r) => r.rec.id));

  return rows.map((r) => ({
    ...r.rec,
    brand: r.brandId
      ? { id: r.brandId, name: r.brandName!, accentColor: r.brandAccent!, logoUrl: r.brandLogoUrl ?? null }
      : null,
    aiTitle: r.aiTitle,
    aiSummary: r.aiSummary,
    aiChapters: r.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: r.aiActionItems as RecordingWithBrand["aiActionItems"],
    viewCount: counts[r.rec.id] ?? 0,
  }));
```

In `getRecordingBySlug`, add the same field. Replace the final `return { ... };` block with:
```ts
  const { countViews } = await import("@/db/queries/views");
  const viewCount = await countViews(row.rec.id);
  return {
    ...row.rec,
    brand: row.brandId
      ? { id: row.brandId, name: row.brandName!, accentColor: row.brandAccent!, logoUrl: row.brandLogoUrl ?? null }
      : null,
    aiTitle: row.aiTitle,
    aiSummary: row.aiSummary,
    aiChapters: row.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: row.aiActionItems as RecordingWithBrand["aiActionItems"],
    viewCount,
  };
```

(The dynamic `import(...)` avoids a circular-import risk if `views.ts` ever imports from `recordings.ts`. It is a normal dynamic import — compiled once, cached.)

- [ ] **Step 2: Surface view count on recording card**

Edit `src/components/dashboard/recording-card.tsx`. Inside the card's metadata row (after the relative-time span, before the brand span), insert:
```tsx
          {rec.viewCount > 0 && (
            <>
              <span>·</span>
              <span>
                {rec.viewCount} view{rec.viewCount === 1 ? "" : "s"}
              </span>
            </>
          )}
```

The surrounding JSX in `recording-card.tsx` that you're modifying currently looks like:
```tsx
        <div className="mt-1 flex items-center gap-2 text-xs opacity-60">
          <span>{formatDuration(rec.durationSeconds)}</span>
          <span>·</span>
          <span>{formatRelative(new Date(rec.createdAt))}</span>
          {rec.brand && (
            <>
              <span>·</span>
              <span>{rec.brand.name}</span>
            </>
          )}
        </div>
```

After edit:
```tsx
        <div className="mt-1 flex items-center gap-2 text-xs opacity-60">
          <span>{formatDuration(rec.durationSeconds)}</span>
          <span>·</span>
          <span>{formatRelative(new Date(rec.createdAt))}</span>
          {rec.viewCount > 0 && (
            <>
              <span>·</span>
              <span>
                {rec.viewCount} view{rec.viewCount === 1 ? "" : "s"}
              </span>
            </>
          )}
          {rec.brand && (
            <>
              <span>·</span>
              <span>{rec.brand.name}</span>
            </>
          )}
        </div>
```

- [ ] **Step 3: Build**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -20
```

Expected: "Compiled successfully" and no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/queries/recordings.ts src/components/dashboard/recording-card.tsx
git commit -m "feat(m8): surface viewCount on dashboard cards + share page"
```

---

## Task 15: Push + live smoke + mark shipped

**Files:**
- Modify: `ROADMAP.md`, `CLAUDE.md`

- [ ] **Step 1: Push**

Run:
```bash
git push origin main
```

Coolify auto-deploys. Wait for the new container:
```bash
until ssh vps "docker ps --filter 'name=yc1k629dxxsnmyg027wt5hag' --format '{{.Status}}' | grep -q 'Up [0-9]\\+ seconds'"; do sleep 15; done && ssh vps "docker ps --filter 'name=yc1k629dxxsnmyg027wt5hag' --format '{{.Names}} {{.Status}}'"
```

- [ ] **Step 2: Verify migrations ran**

Run:
```bash
ssh vps 'docker logs $(docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Names}}") --tail 50 2>&1' | grep -E "migrations|views_media_visitor"
```

Expected: "migrations applied" (or equivalent) — the unique-index migration ran at container boot.

- [ ] **Step 3: Smoke — password round-trip**

In a signed-in browser (as owner) open `https://loom.dissonance.cloud/v/<a-ready-slug>`.

- Verify the "Password: off" toolbar appears.
- Click "Add password", enter `m8-smoke-test`, click Save. Toolbar flips to "Password: on".
- Open the same URL in a private/incognito window. Expected: password form (not the viewer).
- Type a wrong password → "Incorrect password."
- Type `m8-smoke-test` → viewer loads.
- Hard-refresh incognito → viewer still loads (cookie persists).
- Back in the owner window, click "Remove". Refresh the incognito window → viewer loads without the form (no password anymore).

- [ ] **Step 4: Smoke — view tracking**

Still in incognito (owner view-tracking is suppressed), play the video for ~30 seconds. Then run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
(async () => {
  const rows = await sql`SELECT media_object_id, max_watched_sec, watched_seconds, updated_at FROM views ORDER BY updated_at DESC LIMIT 5`;
  console.log(JSON.stringify(rows, null, 2));
  await sql.end();
})();
'
```

Expected: at least one row with `max_watched_sec` between ~15 and ~60.

In owner browser, reload `/v/:slug`: the "Viewer drop-off" section renders with a bar, and the header shows "· 1 view".

On the dashboard (`/`): the card for this recording shows "1 view" in its meta row.

- [ ] **Step 5: Update ROADMAP.md**

In `ROADMAP.md`, change the M8 and M9 rows. Current state:
```
| M8 | Password protect + view tracking | 🔄 next | Unlock cookies, views table, drop-off chart |
| M9 | Comments (V4) | ⏳ planned | Anonymous timestamped comments with Resend email notifications |
```
After:
```
| M8 | Password protect + view tracking | ✅ shipped | Per-video bcrypt passwords with HMAC-signed 24h unlock cookies (auto-invalidated on password change); anonymous IP+UA hashed view tracking via sendBeacon; 10-bucket drop-off chart for owners; view count on dashboard cards |
| M9 | Comments (V4) | 🔄 next | Anonymous timestamped comments with Resend email notifications |
```

- [ ] **Step 6: Update CLAUDE.md**

In `CLAUDE.md`, replace the `[ ] M8: Password-protect + view tracking` line with:
```
- [x] **M8: Password protect + view tracking** — per-video bcrypt passwords, HMAC-signed slug-scoped unlock cookies (24h, auto-invalidated on password change), anonymous view tracking via sendBeacon, owner-only 10-bucket drop-off chart, view counts on dashboard + share page.
```

- [ ] **Step 7: Commit + push**

```bash
git add ROADMAP.md CLAUDE.md
git commit -m "chore(m8): mark password + view tracking milestone shipped"
git push origin main
```

---

## Self-Review Notes

- Spec coverage:
  - Password unlock form + bcrypt verify + signed cookie → Tasks 3, 8, 10, 13.
  - Owner toolbar for set/remove → Tasks 7, 10, 13.
  - Refresh-URL enforcement → Task 8.
  - View upsert + progress → Tasks 6, 9.
  - Owner exclusion from tracking → Task 11 (ViewerShell renders `<Tracking>` only when `!isOwner`).
  - Drop-off chart → Tasks 5, 12, 13.
  - View count on dashboard → Task 14.
  - Unique index + migration → Task 2.
  - Secrets (`VIEW_UNLOCK_SECRET`, `VISITOR_HASH_SALT`) — already seeded in Doppler during brainstorming; no plan task needed.

- Types are consistent across tasks:
  - `signUnlockToken({ slug, passwordHash })` / `verifyUnlockToken({ slug, passwordHash, token })` — single object-arg signature used everywhere.
  - `bucketize(maxList, durationSec, bucketCount?)` — used consistently.
  - `hashVisitor(request: Request)` — same signature everywhere.
  - `ViewerShellProps.isOwner: boolean` — required prop.
  - `OwnerToolbar({ recordingId, hasPassword })` — matches the page's call.

- Risk mitigations from the spec:
  - Password change invalidates cookies via HMAC path including password_hash — implemented in Task 3; test covers it.
  - sendBeacon size is well under Chrome's 64KB cap (payload is ~15 bytes) — no mitigation needed.
  - bcryptjs (pure JS) avoids native-build concerns in Alpine — Task 1 chose the right package.
  - Visitor with no IP headers → stable zero-hash row, noted in visitor-id test.
