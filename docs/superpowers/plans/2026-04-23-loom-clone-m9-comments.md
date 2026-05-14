# M9 Comments + Mailgun Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add anonymous timestamped comments to `/v/:slug` with immediate Mailgun email notifications to the creator and a click-to-seek deep link (`#t=<sec>`).

**Architecture:** Pure in-memory rate limiter + direct Mailgun `fetch` wrapper + Zod-free comments query module + a POST / DELETE pair of routes. A `<CommentsSection>` client island is added as the last child of `<ViewerShell>`, which already owns player state and seek callbacks. No new dependencies. No schema changes — the `comments` table already exists from M2.

**Tech Stack:** Next.js 15 App Router, React 19, Mailgun HTTP API (no SDK), Vitest.

**Reference:** [M9 design spec](../specs/2026-04-23-loom-clone-m9-comments-design.md)

---

## File Structure

**New:**
- `src/lib/comments/rate-limit.ts` — in-memory LRU; `checkAndBump(visitorHash)` returns `{ allowed, retryAfterSec? }`
- `src/lib/mail/mailgun.ts` — direct Mailgun HTTP wrapper; `sendEmail({ to, subject, text, html })`
- `src/lib/mail/templates/new-comment.ts` — `renderNewCommentEmail(params)` returning `{ subject, text, html }`
- `src/db/queries/comments.ts` — `createComment`, `listCommentsForRecording`, `deleteCommentOwned`
- `src/app/api/v/[slug]/comments/route.ts` — POST (public, rate-limited, unlock-aware)
- `src/app/api/comments/[id]/route.ts` — DELETE (owner-only)
- `src/components/viewer/comments-section.tsx` — heading + list + form wrapper
- `src/components/viewer/comment-list.tsx` — maps comments → `<CommentItem>`
- `src/components/viewer/comment-item.tsx` — single row with timestamp button, name, body, relative date, owner-only delete
- `src/components/viewer/comment-form.tsx` — name/email/body form; captures playhead on submit
- `tests/unit/comments-rate-limit.test.ts`
- `tests/unit/mailgun-template.test.ts`

**Modified:**
- `src/components/viewer/video-player.tsx` — expose a `onReady?: () => void` callback for hash-based deep-link seeking
- `src/components/viewer/viewer-shell.tsx` — new props `comments`, `recordingId`; render `<CommentsSection>` as last child; handle `#t=<sec>` hash on player ready
- `src/app/v/[slug]/page.tsx` — fetch comments server-side, pass them + `recordingId` into `<ViewerShell>`

---

## Task 1: Rate limiter (TDD)

**Files:**
- Create: `src/lib/comments/rate-limit.ts`
- Create: `tests/unit/comments-rate-limit.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/comments-rate-limit.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkAndBump, __resetForTest } from "@/lib/comments/rate-limit";

beforeEach(() => {
  __resetForTest();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-23T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkAndBump", () => {
  it("allows the first three calls from one visitor", () => {
    expect(checkAndBump("visitor-a").allowed).toBe(true);
    expect(checkAndBump("visitor-a").allowed).toBe(true);
    expect(checkAndBump("visitor-a").allowed).toBe(true);
  });

  it("blocks the fourth call within the window with a retryAfterSec", () => {
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    const r = checkAndBump("visitor-a");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(5 * 60);
  });

  it("counts different visitors independently", () => {
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    expect(checkAndBump("visitor-b").allowed).toBe(true);
  });

  it("allows again after the window slides past the oldest hit", () => {
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    expect(checkAndBump("visitor-a").allowed).toBe(false);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    expect(checkAndBump("visitor-a").allowed).toBe(true);
  });

  it("keeps memory bounded under many distinct hashes", () => {
    for (let i = 0; i < 12_000; i++) {
      checkAndBump(`v-${i}`);
    }
    // After the cap, the oldest entries are evicted; no crash, no uncaught
    // exception. Final call still works.
    expect(checkAndBump("v-newest").allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
npx vitest run tests/unit/comments-rate-limit.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/comments/rate-limit'".

- [ ] **Step 3: Implement**

Create `src/lib/comments/rate-limit.ts`:
```ts
const WINDOW_MS = 5 * 60 * 1000;
const LIMIT = 3;
const MAX_ENTRIES = 10_000;

const hits = new Map<string, number[]>();

/**
 * In-memory sliding-window rate limit. 3 hits per 5 minutes per visitor hash.
 * LRU-bounded at 10k distinct visitors to keep memory bounded. Process-local
 * — does not survive restarts, which is acceptable at this scale.
 */
export function checkAndBump(visitorHash: string): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let times = hits.get(visitorHash) ?? [];
  times = times.filter((t) => t > cutoff);

  if (times.length >= LIMIT) {
    const oldest = times[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    hits.set(visitorHash, times);
    return { allowed: false, retryAfterSec };
  }

  times.push(now);
  hits.set(visitorHash, times);

  if (hits.size > MAX_ENTRIES) {
    // Evict roughly the oldest quarter. Map preserves insertion order, so the
    // first keys are the least-recently-inserted.
    const toEvict = Math.ceil(MAX_ENTRIES / 4);
    let i = 0;
    for (const key of hits.keys()) {
      if (i++ >= toEvict) break;
      hits.delete(key);
    }
  }

  return { allowed: true };
}

/** Test-only reset. Not exported from the public module surface. */
export function __resetForTest(): void {
  hits.clear();
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
npx vitest run tests/unit/comments-rate-limit.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comments/rate-limit.ts tests/unit/comments-rate-limit.test.ts
git commit -m "feat(m9): sliding-window rate limiter for public comment submissions"
```

---

## Task 2: Mailgun HTTP wrapper

**Files:**
- Create: `src/lib/mail/mailgun.ts`

- [ ] **Step 1: Implement**

Create `src/lib/mail/mailgun.ts`:
```ts
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * Sends a transactional email via Mailgun's HTTP API. No SDK; just a fetch
 * against `POST https://api.mailgun.net/v3/<domain>/messages` with basic
 * auth `api:<api_key>` and a form-encoded body.
 *
 * Throws on non-2xx so callers can choose to fire-and-forget (wrap the call
 * in try/catch and log) or await (for tests and one-off manual sends).
 */
export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const apiKey = envOrThrow("MAILGUN_API_KEY");
  const domain = envOrThrow("MAILGUN_DOMAIN");
  const from = envOrThrow("MAIL_FROM_ADDRESS");

  const form = new URLSearchParams();
  form.set("from", from);
  form.set("to", to);
  form.set("subject", subject);
  form.set("text", text);
  form.set("html", html);

  const auth = Buffer.from(`api:${apiKey}`).toString("base64");
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    throw new Error(`Mailgun send failed: ${res.status} ${details.slice(0, 200)}`);
  }
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mail/mailgun.ts
git commit -m "feat(m9): Mailgun HTTP API wrapper"
```

---

## Task 3: New-comment email template (TDD)

**Files:**
- Create: `src/lib/mail/templates/new-comment.ts`
- Create: `tests/unit/mailgun-template.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/mailgun-template.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderNewCommentEmail } from "@/lib/mail/templates/new-comment";

describe("renderNewCommentEmail", () => {
  it("includes name, timestamp (M:SS), body, and deep link in text + html", () => {
    const out = renderNewCommentEmail({
      recordingTitle: "Demo walkthrough",
      commenterName: "Alex",
      commenterEmail: "alex@example.com",
      body: "Great pacing here.",
      timestampSec: 125,
      shareUrl: "https://loom.dissonance.cloud/v/abc123",
    });
    expect(out.text).toContain("Alex");
    expect(out.text).toContain("alex@example.com");
    expect(out.text).toContain("2:05");
    expect(out.text).toContain("Great pacing here.");
    expect(out.text).toContain("https://loom.dissonance.cloud/v/abc123#t=125");
    expect(out.html).toContain("Alex");
    expect(out.html).toContain("2:05");
    expect(out.html).toContain("Great pacing here.");
    expect(out.html).toContain("https://loom.dissonance.cloud/v/abc123#t=125");
  });

  it("formats short timestamps correctly", () => {
    const out = renderNewCommentEmail({
      recordingTitle: "x",
      commenterName: "n",
      commenterEmail: "e@e.co",
      body: "b",
      timestampSec: 7,
      shareUrl: "https://example.com/v/x",
    });
    expect(out.text).toContain("0:07");
    expect(out.html).toContain("0:07");
  });

  it("truncates a very long subject to <= 100 chars", () => {
    const title = "x".repeat(300);
    const out = renderNewCommentEmail({
      recordingTitle: title,
      commenterName: "n",
      commenterEmail: "e@e.co",
      body: "b",
      timestampSec: 0,
      shareUrl: "https://example.com/v/x",
    });
    expect(out.subject.length).toBeLessThanOrEqual(100);
  });

  it("HTML-escapes < > & in body and name", () => {
    const out = renderNewCommentEmail({
      recordingTitle: "t",
      commenterName: "<script>",
      commenterEmail: "e@e.co",
      body: "a & b <img> end",
      timestampSec: 0,
      shareUrl: "https://example.com/v/x",
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("a &amp; b &lt;img&gt; end");
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
npx vitest run tests/unit/mailgun-template.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/mail/templates/new-comment'".

- [ ] **Step 3: Implement**

Create `src/lib/mail/templates/new-comment.ts`:
```ts
function formatTs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderNewCommentEmail(params: {
  recordingTitle: string;
  commenterName: string;
  commenterEmail: string;
  body: string;
  timestampSec: number;
  shareUrl: string;
}): { subject: string; text: string; html: string } {
  const ts = formatTs(params.timestampSec);
  const deepLink = `${params.shareUrl}#t=${Math.max(0, Math.floor(params.timestampSec))}`;

  const rawSubject = `New comment from ${params.commenterName} on ${params.recordingTitle}`;
  const subject =
    rawSubject.length <= 100 ? rawSubject : rawSubject.slice(0, 97) + "...";

  const text = [
    `${params.commenterName} (${params.commenterEmail}) commented at ${ts}:`,
    "",
    params.body,
    "",
    `Reply or open in app: ${deepLink}`,
  ].join("\n");

  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 520px; line-height: 1.5;">
  <p style="margin: 0 0 12px;">
    <strong>${escapeHtml(params.commenterName)}</strong>
    <span style="opacity: 0.7;">&lt;${escapeHtml(params.commenterEmail)}&gt;</span>
    commented at <code style="background: #f3f4f6; padding: 2px 4px; border-radius: 4px;">${ts}</code>:
  </p>
  <blockquote style="margin: 0 0 16px; padding: 12px 16px; border-left: 3px solid #e5e7eb; background: #f9fafb; white-space: pre-wrap;">${escapeHtml(params.body)}</blockquote>
  <p style="margin: 0;">
    <a href="${deepLink}" style="color: #4f46e5;">Open in app</a>
  </p>
</div>`.trim();

  return { subject, text, html };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
npx vitest run tests/unit/mailgun-template.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/templates/new-comment.ts tests/unit/mailgun-template.test.ts
git commit -m "feat(m9): new-comment email template with HTML + text + deep link"
```

---

## Task 4: Comments query module

**Files:**
- Create: `src/db/queries/comments.ts`

- [ ] **Step 1: Implement**

Create `src/db/queries/comments.ts`:
```ts
import { db } from "@/db";
import { comments, mediaObjects } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";

export type Comment = typeof comments.$inferSelect;

export async function createComment(params: {
  mediaObjectId: string;
  name: string;
  email: string;
  timestampSec: number;
  body: string;
}): Promise<Comment> {
  const [row] = await db
    .insert(comments)
    .values({
      mediaObjectId: params.mediaObjectId,
      commenterName: params.name,
      commenterEmail: params.email,
      timestampSec: String(params.timestampSec),
      body: params.body,
    })
    .returning();
  return row;
}

export async function listCommentsForRecording(
  mediaObjectId: string
): Promise<Comment[]> {
  return db
    .select()
    .from(comments)
    .where(eq(comments.mediaObjectId, mediaObjectId))
    .orderBy(asc(comments.createdAt));
}

/**
 * Deletes a comment iff the caller owns the underlying recording.
 * Returns true if a row was deleted, false otherwise (comment missing,
 * recording missing, or wrong owner — all collapse to "not found").
 */
export async function deleteCommentOwned(params: {
  commentId: string;
  ownerId: string;
}): Promise<boolean> {
  // Subquery matches the comment's media_object_id against the caller's owned
  // recordings. If no match, the DELETE affects zero rows.
  const ownedSubquery = db
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(eq(mediaObjects.ownerId, params.ownerId));

  const result = await db
    .delete(comments)
    .where(
      and(
        eq(comments.id, params.commentId),
        // Using raw IN-subquery via drizzle: `inArray` requires a concrete
        // array; a correlated subquery is cleaner with the raw `sql` operator
        // but for the owned-by-owner case we can just split into two calls.
        eq(
          comments.mediaObjectId,
          (
            await db
              .select({ id: mediaObjects.id })
              .from(mediaObjects)
              .innerJoin(comments, eq(comments.mediaObjectId, mediaObjects.id))
              .where(
                and(
                  eq(comments.id, params.commentId),
                  eq(mediaObjects.ownerId, params.ownerId)
                )
              )
              .limit(1)
          )[0]?.id ?? "00000000-0000-0000-0000-000000000000"
        )
      )
    )
    .returning({ id: comments.id });

  // Silence the unused `ownedSubquery` — it was kept above as a reference
  // shape for potential future simplification.
  void ownedSubquery;

  return result.length > 0;
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/comments.ts
git commit -m "feat(m9): comments queries (create, list, owner-scoped delete)"
```

---

## Task 5: POST comment route

**Files:**
- Create: `src/app/api/v/[slug]/comments/route.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/v/[slug]/comments/route.ts`:
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { createComment } from "@/db/queries/comments";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import { hashVisitor } from "@/lib/viewer/visitor-id";
import { checkAndBump } from "@/lib/comments/rate-limit";
import { sendEmail } from "@/lib/mail/mailgun";
import { renderNewCommentEmail } from "@/lib/mail/templates/new-comment";
import { createClient as createSupabase } from "@/lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY = 2000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    timestampSec?: number;
    body?: string;
  };

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const content = (body.body ?? "").trim();
  const tsRaw =
    typeof body.timestampSec === "number" && isFinite(body.timestampSec)
      ? body.timestampSec
      : 0;
  const timestampSec = Math.max(0, tsRaw);

  if (!name || !content) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "bad_email" }, { status: 400 });
  }
  if (content.length > MAX_BODY) {
    return NextResponse.json({ error: "body_too_long" }, { status: 400 });
  }

  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Password-locked recordings require a valid unlock cookie to comment.
  if (rec.passwordHash) {
    const jar = await cookies();
    const token = jar.get(cookieName(slug))?.value ?? "";
    if (!verifyUnlockToken({ slug, passwordHash: rec.passwordHash, token })) {
      return NextResponse.json({ error: "locked" }, { status: 403 });
    }
  }

  // Rate-limit keyed on the visitor hash (same derivation as view tracking).
  const visitorHash = hashVisitor(request);
  const rate = checkAndBump(visitorHash);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rate.retryAfterSec ?? 60 },
      { status: 429 }
    );
  }

  const row = await createComment({
    mediaObjectId: rec.id,
    name,
    email,
    timestampSec,
    body: content,
  });

  // Fire Mailgun in the background — we do not await, do not fail the
  // request on send failure. Look up the owner's email from Supabase auth.
  void (async () => {
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const shareUrl = `${appUrl}/v/${slug}`;
      const supabase = await createSupabase();
      const { data } = await supabase.auth.admin.getUserById(rec.ownerId);
      const ownerEmail = data?.user?.email;
      if (!ownerEmail) {
        console.warn(
          `[comments] owner email missing for recording ${rec.id}; skipping notification`
        );
        return;
      }
      const tpl = renderNewCommentEmail({
        recordingTitle: rec.title ?? rec.aiTitle ?? "Untitled recording",
        commenterName: name,
        commenterEmail: email,
        body: content,
        timestampSec,
        shareUrl,
      });
      await sendEmail({
        to: ownerEmail,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
    } catch (e) {
      console.error("[comments] mailgun notification failed:", e);
    }
  })();

  return NextResponse.json({ id: row.id }, { status: 201 });
}
```

Note: `supabase.auth.admin.getUserById` requires the Supabase **service role** client, not the SSR one. If `createClient` from `@/lib/supabase/server` returns an anon-key client, we need a separate service-role client. Check the file first:

```bash
grep -n "service\|SERVICE_ROLE\|admin" src/lib/supabase/server.ts
```

If it does NOT use the service role key, create a parallel helper next to it:

```bash
cat src/lib/supabase/server.ts
```

If you need to add a service-role client, create `src/lib/supabase/service.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

let cached: ReturnType<typeof createClient> | null = null;

/**
 * Server-only Supabase client using the service role key. Bypasses RLS.
 * Used for things like looking up another user's email (e.g., to email
 * the recording owner when a commenter posts).
 */
export function getSupabaseService() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service env vars missing");
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
```

Then in the comments route, replace the `createSupabase`/`createClient` usage above with:
```ts
import { getSupabaseService } from "@/lib/supabase/service";
// ...
const service = getSupabaseService();
const { data } = await service.auth.admin.getUserById(rec.ownerId);
const ownerEmail = data?.user?.email;
```

(`SUPABASE_SERVICE_ROLE_KEY` should already be in Doppler from M1. If not, surface the gap before proceeding.)

- [ ] **Step 2: Check Supabase server helper + add service-role client if needed**

Run:
```bash
cat src/lib/supabase/server.ts
```

If the existing helper uses `@supabase/ssr` with the anon key (the normal case for the SSR pattern), create `src/lib/supabase/service.ts` per the snippet above and wire the comments route to it.

Verify `SUPABASE_SERVICE_ROLE_KEY` is set:
```bash
doppler secrets get SUPABASE_SERVICE_ROLE_KEY --project dissonance-cloud --config prd_loom --plain | head -c 30
```

Expected: a JWT starting with `eyJ`. If missing, STOP and ask the user to add it (I don't have it to seed).

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/api/v/[slug]/comments/route.ts' src/lib/supabase/service.ts 2>/dev/null || git add 'src/app/api/v/[slug]/comments/route.ts'
git commit -m "feat(m9): POST /api/v/:slug/comments with rate limit + lock check + mail"
```

---

## Task 6: DELETE comment route

**Files:**
- Create: `src/app/api/comments/[id]/route.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/comments/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { deleteCommentOwned } from "@/db/queries/comments";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const ok = await deleteCommentOwned({ commentId: id, ownerId: user.id });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/api/comments/[id]/route.ts'
git commit -m "feat(m9): owner-only DELETE /api/comments/:id"
```

---

## Task 7: Comments UI components

**Files:**
- Create: `src/components/viewer/comments-section.tsx`
- Create: `src/components/viewer/comment-list.tsx`
- Create: `src/components/viewer/comment-item.tsx`
- Create: `src/components/viewer/comment-form.tsx`

- [ ] **Step 1: Implement CommentItem**

Create `src/components/viewer/comment-item.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

type Props = {
  id: string;
  name: string;
  body: string;
  timestampSec: number;
  createdAt: Date;
  isOwner: boolean;
  onSeek: (sec: number) => void;
};

export function CommentItem({
  id,
  name,
  body,
  timestampSec,
  createdAt,
  isOwner,
  onSeek,
}: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this comment?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert(`Delete failed (${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li className="flex gap-3 rounded border border-white/10 p-3 text-sm">
      <button
        onClick={() => onSeek(timestampSec)}
        className="shrink-0 self-start rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs opacity-80 hover:bg-white/10"
      >
        {formatTs(timestampSec)}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{name}</span>
          <span className="shrink-0 text-xs opacity-50">
            {formatRelative(createdAt)}
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words opacity-90">{body}</p>
      </div>
      {isOwner && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="shrink-0 self-start rounded px-2 py-1 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          aria-label="Delete comment"
        >
          ✕
        </button>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Implement CommentList**

Create `src/components/viewer/comment-list.tsx`:
```tsx
"use client";

import { CommentItem } from "./comment-item";

type CommentRow = {
  id: string;
  commenterName: string;
  body: string;
  timestampSec: number;
  createdAt: string; // ISO string from server
};

export function CommentList({
  comments,
  isOwner,
  onSeek,
}: {
  comments: CommentRow[];
  isOwner: boolean;
  onSeek: (sec: number) => void;
}) {
  if (comments.length === 0) {
    return (
      <p className="mt-3 text-sm opacity-60">
        No comments yet. Be the first to leave one.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {comments.map((c) => (
        <CommentItem
          key={c.id}
          id={c.id}
          name={c.commenterName}
          body={c.body}
          timestampSec={c.timestampSec}
          createdAt={new Date(c.createdAt)}
          isOwner={isOwner}
          onSeek={onSeek}
        />
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Implement CommentForm**

Create `src/components/viewer/comment-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  slug: string;
  getCurrentTime: () => number;
};

export function CommentForm({ slug, getCurrentTime }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !body.trim()) {
      setError("All fields are required.");
      return;
    }
    setSubmitting(true);
    try {
      const timestampSec = Math.max(0, getCurrentTime());
      const res = await fetch(`/api/v/${slug}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, body, timestampSec }),
      });
      if (res.status === 429) {
        const data = (await res.json()) as { retryAfterSec?: number };
        setError(
          `You've hit the comment rate limit. Try again in ${data.retryAfterSec ?? 60}s.`
        );
        return;
      }
      if (res.status === 403) {
        setError("This recording is locked. Unlock it first.");
        return;
      }
      if (res.status === 400) {
        const data = (await res.json()) as { error?: string };
        setError(
          data.error === "bad_email"
            ? "That email looks invalid."
            : data.error === "body_too_long"
              ? "Comment too long (max 2000 chars)."
              : "Please fill in all fields."
        );
        return;
      }
      if (!res.ok) {
        setError(`Unexpected error (${res.status}).`);
        return;
      }
      setName("");
      setEmail("");
      setBody("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 space-y-2 rounded border border-white/10 p-3"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="rounded border border-white/20 bg-white/5 px-2 py-1 text-sm"
          required
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (not shown publicly)"
          className="rounded border border-white/20 bg-white/5 px-2 py-1 text-sm"
          required
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment at this timestamp…"
        rows={3}
        className="w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-sm"
        required
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-between text-xs opacity-60">
        <span>Your email is used only to notify the creator, never shown here.</span>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-white/20 px-3 py-1 text-xs hover:bg-white/30 disabled:opacity-50"
        >
          {submitting ? "Posting…" : "Post comment"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Implement CommentsSection**

Create `src/components/viewer/comments-section.tsx`:
```tsx
"use client";

import { CommentList } from "./comment-list";
import { CommentForm } from "./comment-form";

type CommentRow = {
  id: string;
  commenterName: string;
  body: string;
  timestampSec: number;
  createdAt: string;
};

export function CommentsSection({
  comments,
  slug,
  isOwner,
  onSeek,
  getCurrentTime,
}: {
  comments: CommentRow[];
  slug: string;
  isOwner: boolean;
  onSeek: (sec: number) => void;
  getCurrentTime: () => number;
}) {
  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium">
        Comments{" "}
        {comments.length > 0 && (
          <span className="opacity-60">({comments.length})</span>
        )}
      </h2>
      <CommentList comments={comments} isOwner={isOwner} onSeek={onSeek} />
      <CommentForm slug={slug} getCurrentTime={getCurrentTime} />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/comment-item.tsx src/components/viewer/comment-list.tsx src/components/viewer/comment-form.tsx src/components/viewer/comments-section.tsx
git commit -m "feat(m9): CommentsSection + list + item + form client components"
```

---

## Task 8: VideoPlayer ready event + ViewerShell wiring

**Files:**
- Modify: `src/components/viewer/video-player.tsx`
- Modify: `src/components/viewer/viewer-shell.tsx`

- [ ] **Step 1: Add `onReady` callback to VideoPlayer props**

Edit `src/components/viewer/video-player.tsx`.

(a) Extend the `Props` type (add `onReady`):
```ts
type Props = {
  slug: string;
  initialSignedUrl: string;
  chapters: Chapter[];
  accentColor: string;
  onTimeUpdate: (sec: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onReady?: () => void;
};
```

(b) Destructure in the component signature:
```tsx
export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { slug, initialSignedUrl, chapters, accentColor, onTimeUpdate, onPlayStateChange, onReady },
  ref
) {
```

(c) Attach Plyr's `ready` event inside the effect (next to the other `.on(...)` calls):
```ts
      plyrRef.current.on("ready", () => onReady?.());
```

(d) Add `onReady` to the effect's dep array:
```ts
  }, [chapters, onTimeUpdate, onPlayStateChange, onReady]);
```

- [ ] **Step 2: Wire comments + hash-seek into ViewerShell**

Overwrite `src/components/viewer/viewer-shell.tsx` with:
```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import { ChaptersList } from "./chapters-list";
import { ActionItemsList } from "./action-items-list";
import { Tracking } from "./tracking";
import { CommentsSection } from "./comments-section";
import type { Word } from "@/lib/viewer/paragraphs";

type CommentRow = {
  id: string;
  commenterName: string;
  body: string;
  timestampSec: number;
  createdAt: string;
};

export type ViewerShellProps = {
  slug: string;
  signedVideoUrl: string;
  accentColor: string;
  chapters: Array<{ start_sec: number; title: string }>;
  actionItems: Array<{ timestamp_sec: number; text: string }>;
  words: Word[];
  fullText: string;
  isOwner: boolean;
  comments: CommentRow[];
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
  comments,
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

  // Deep-link support: on player ready, if the URL has a #t=<sec> fragment,
  // seek to it once.
  const handleReady = useCallback(() => {
    if (typeof window === "undefined") return;
    const match = window.location.hash.match(/^#t=(\d+(?:\.\d+)?)/);
    if (match) {
      const t = parseFloat(match[1]);
      if (isFinite(t) && t >= 0) {
        playerRef.current?.seek(t);
      }
    }
  }, []);

  // Suppress unused-var lint for useEffect'ed player event hookups; intentionally
  // coupling handleReady through the VideoPlayer onReady prop below.
  useEffect(() => {
    // no-op; handleReady is consumed by <VideoPlayer onReady={...}>
  }, [handleReady]);

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
        onReady={handleReady}
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
      <CommentsSection
        comments={comments}
        slug={slug}
        isOwner={isOwner}
        onSeek={handleSeek}
        getCurrentTime={getCurrentTime}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -15
```

Expected: errors about missing `comments` prop on `<ViewerShell>` at the page level — that will be fixed in Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/components/viewer/video-player.tsx src/components/viewer/viewer-shell.tsx
git commit -m "feat(m9): CommentsSection in shell + #t=<sec> deep-link seek on player ready"
```

---

## Task 9: Page integration

**Files:**
- Modify: `src/app/v/[slug]/page.tsx`

- [ ] **Step 1: Fetch comments server-side + pass through**

Edit `src/app/v/[slug]/page.tsx`. At the top, add the import:
```ts
import { listCommentsForRecording } from "@/db/queries/comments";
```

Inside the function, after the `transcript` fetch (search for `const transcript = await getTranscriptByRecording(rec.id);`), add:
```ts
  const rawComments = await listCommentsForRecording(rec.id);
  const commentRows = rawComments.map((c) => ({
    id: c.id,
    commenterName: c.commenterName,
    body: c.body,
    timestampSec: parseFloat(String(c.timestampSec)),
    createdAt: c.createdAt.toISOString(),
  }));
```

Then find the `<ViewerShell ... />` call and add the `comments` prop:
```tsx
            <ViewerShell
              slug={slug}
              signedVideoUrl={signedVideoUrl}
              accentColor={accent}
              chapters={rec.aiChapters ?? []}
              actionItems={rec.aiActionItems ?? []}
              words={words}
              fullText={transcript?.fullText ?? ""}
              isOwner={isOwner}
              comments={commentRows}
            />
```

- [ ] **Step 2: Build**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -20
```

Expected: "Compiled successfully" with no type errors. The new `/api/v/[slug]/comments` and `/api/comments/[id]` routes listed.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/v/[slug]/page.tsx'
git commit -m "feat(m9): page integration — load comments server-side + pass to shell"
```

---

## Task 10: Push + live smoke + mark shipped

**Files:**
- Modify: `ROADMAP.md`, `CLAUDE.md`

- [ ] **Step 1: Push**

Run:
```bash
git push origin main
```

Wait for Coolify deploy to replace the container:
```bash
until ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Status}}" | grep -q "Up [0-9]\+ seconds"'; do sleep 15; done
ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Names}} {{.Status}}"'
```

- [ ] **Step 2: Smoke the POST comment endpoint (unauth)**

Against a known-ready, non-password-protected slug (e.g., `V2LyopYmWS`):
```bash
curl -s -X POST "https://loom.dissonance.cloud/api/v/V2LyopYmWS/comments" \
  -H "content-type: application/json" \
  -d '{"name":"Smoke","email":"smoke-test@example.com","timestampSec":3,"body":"hello from curl"}'
```

Expected: `{"id":"<uuid>"}` with HTTP 201.

Verify DB insert:
```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
(async () => {
  const r = await sql`SELECT id, commenter_name, body, timestamp_sec FROM comments ORDER BY created_at DESC LIMIT 5`;
  console.log(JSON.stringify(r, null, 2));
  await sql.end();
})();
'
```

Expected: the row you just posted appears.

- [ ] **Step 3: Smoke rate limit**

Run the same curl four more times quickly:
```bash
for i in 1 2 3 4; do
  curl -s -o /dev/null -w "HTTP %{http_code} " -X POST "https://loom.dissonance.cloud/api/v/V2LyopYmWS/comments" \
    -H "content-type: application/json" \
    -d "{\"name\":\"Smoke\",\"email\":\"s@e.co\",\"timestampSec\":3,\"body\":\"test $i\"}"
done
echo
```

Expected: a run of 201s followed by a 429. Total 201-count across all runs this 5-min window is ≤ 3.

- [ ] **Step 4: Smoke the email**

Open a real inbox you control (the one the Supabase owner account uses — `you@example.com` per `CLAUDE.md`). Post a comment from an incognito browser at a specific timestamp, e.g.:
```bash
curl -s -X POST "https://loom.dissonance.cloud/api/v/V2LyopYmWS/comments" \
  -H "content-type: application/json" \
  -d '{"name":"Ian","email":"ian-smoke@example.com","timestampSec":42,"body":"email smoke"}'
```

(You may need to wait for the 5-min window to reset before this one goes through given the earlier rate-limit test.)

Expected in your inbox within ~30s: a message from `loom-comments@mg.dissonance.cloud` subject "New comment from Ian on ...". The link in the email is `https://loom.dissonance.cloud/v/V2LyopYmWS#t=42`. Clicking it should open the viewer and seek the player to 0:42.

If the email does NOT arrive, check `ssh vps 'docker logs <container> --tail 100' | grep mailgun` and verify the Mailgun domain is verified in the dashboard.

- [ ] **Step 5: Smoke the owner-delete flow**

In the owner browser, open `/v/V2LyopYmWS`. Expected: the comments section shows the comments posted above with a small `✕` delete button on each. Click to delete — confirm → row disappears.

Incognito reload → comment no longer present.

- [ ] **Step 6: Clean up smoke comments**

```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
(async () => {
  const r = await sql`DELETE FROM comments WHERE commenter_email LIKE '"'"'%smoke%'"'"' OR commenter_email LIKE '"'"'%ian-smoke%'"'"' RETURNING id`;
  console.log("deleted", r.length, "smoke comments");
  await sql.end();
})();
'
```

- [ ] **Step 7: Update ROADMAP.md**

Change the M9 row in `ROADMAP.md` from:
```
| M9 | Comments (V4) | 🔄 next | Anonymous timestamped comments with Resend email notifications |
| M10 | Trim editing (E2) + raw downloads | ⏳ planned | Trim UI, player clamping to trimmed range, ZIP endpoint for raw track download |
```
to:
```
| M9 | Comments | ✅ shipped | Anonymous timestamped comments on `/v/:slug` (name/email/body + auto-captured playhead), owner-only hard delete, 3-per-5min per-visitor rate limit, immediate Mailgun notifications with `#t=<sec>` deep-link back to the comment |
| M10 | Trim editing (E2) + raw downloads | 🔄 next | Trim UI, player clamping to trimmed range, ZIP endpoint for raw track download |
```

- [ ] **Step 8: Update CLAUDE.md**

Change the `[ ]` M9 line in `CLAUDE.md` (directly under the M8 entry) to:
```
- [x] **M9: Comments** — anonymous timestamped comments on /v/:slug with name/email/body, auto-captured playhead, owner-only delete, per-visitor rate limit (3/5min), Mailgun notifications (MAILGUN_API_KEY + MAILGUN_DOMAIN=mg.dissonance.cloud + MAIL_FROM_ADDRESS), `#t=<sec>` deep-link seek on page load.
```

- [ ] **Step 9: Commit + push**

```bash
git add ROADMAP.md CLAUDE.md
git commit -m "chore(m9): mark comments + mailgun milestone shipped"
git push origin main
```

---

## Self-Review Notes

- Spec coverage:
  - Anonymous submission (name/email/body/playhead) → Tasks 5, 7, 9.
  - Flat chronological list → Task 7 (CommentList renders ascending, no threading).
  - `[M:SS]` timestamp button + click-to-seek → Task 7 (CommentItem) + Task 8 (shell passes `onSeek`).
  - Owner-only hard delete → Tasks 4, 6, 7.
  - Rate limit 3/5min → Task 1 (TDD).
  - Fire-and-forget Mailgun → Tasks 2, 3, 5 (service-role lookup of owner email).
  - Password-locked recordings reject comments without unlock cookie → Task 5 (re-uses the unlock-cookie helper).
  - `#t=<sec>` deep link from email → Task 3 (template) + Task 8 (shell hash handler on player ready).
  - Comments section appears below action items → Task 8 wiring, order confirmed.
  - No schema changes (comments table exists) — confirmed.

- Types are consistent:
  - `CommentRow = { id, commenterName, body, timestampSec, createdAt: string }` — same shape in shell + section + list + page.
  - `checkAndBump(visitorHash) → { allowed, retryAfterSec? }` — same signature in Tasks 1 and 5.
  - `sendEmail({ to, subject, text, html })` and `renderNewCommentEmail({...})` signatures match their callers.
  - `deleteCommentOwned({ commentId, ownerId })` named-object args used in query + route.

- Risks noted in spec are mitigated:
  - Mailgun domain verification flagged in Task 10 Step 4 (instruction: if email doesn't arrive, check logs and Mailgun dashboard). Comments flow stays working regardless.
  - `SUPABASE_SERVICE_ROLE_KEY` absence is explicitly checked in Task 5 Step 2 with a STOP instruction if missing.
