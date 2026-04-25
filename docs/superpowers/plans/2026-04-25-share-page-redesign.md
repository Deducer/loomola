# Share Page Redesign + Creator Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `/v/:slug` (visitor surface) from `/recordings/[id]/edit` (creator console), and redesign the share page to feel zen and curated — Loom-style chapter segments on the seekbar, summary + action items + chapters list above tabs (Transcript · Comments).

**Architecture:** Three independently shippable phases. Phase 1 lifts existing creator controls onto a new edit page (zero functionality regression, share page becomes simpler). Phase 2 redesigns the share page itself (chapter segments overlay, content tabs, layout refactor). Phase 3 polishes the edit page (inline title rename, brand picker, redesigned drop-off chart, delete confirmation, section layout).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5, Tailwind v4 with CSS-var tokens, Plyr 3, Drizzle ORM, Vitest + Playwright.

**Spec:** [`docs/superpowers/specs/2026-04-25-share-page-redesign-design.md`](../specs/2026-04-25-share-page-redesign-design.md)

---

## File Map

**New files (Phase 1):**
- `src/app/recordings/[id]/edit/page.tsx` — server component, auth + ownership guard, fetches data
- `src/components/edit/edit-shell.tsx` — sticky-preview two-column layout shell
- `src/components/edit/preview-player.tsx` — small Plyr wrapper for the edit page
- `tests/e2e/edit-page.spec.ts` — auth, ownership, and basic visibility

**New files (Phase 2):**
- `src/components/viewer/chapter-segments.tsx` — overlay rendered on top of `.plyr__progress`
- `src/components/viewer/summary-block.tsx`
- `src/components/viewer/action-items-block.tsx`
- `src/components/viewer/content-tabs.tsx`
- `tests/unit/chapter-segments.test.ts` — segment width / offset math
- `tests/e2e/share-page.spec.ts` — tab switch, chapter row click, segment overlay rendered

**New files (Phase 3):**
- `src/components/edit/edit-header.tsx` — inline title rename + status + share URL + view-public link
- `src/components/edit/settings-section.tsx` — brand picker + password form
- `src/components/edit/trim-section.tsx` — wraps existing `TrimEditor`
- `src/components/edit/downloads-section.tsx` — wraps existing `DownloadsList`
- `src/components/edit/analytics-section.tsx` — wraps the new drop-off chart + view count
- `src/components/edit/danger-zone.tsx` — delete with confirm modal
- `src/components/edit/dropoff-chart.tsx` — filled-area SVG redesign
- `src/app/api/recordings/[id]/brand/route.ts` — PATCH brand assignment
- `tests/unit/dropoff-chart-path.test.ts` — SVG path generation math
- `tests/unit/recording-update.test.ts` — title + brand update query

**Modified files:**
- `src/app/v/[slug]/page.tsx` — drop owner-only fetches, drop OwnerToolbar / DropoffChart / share URL / view count, add Edit pill
- `src/components/viewer/viewer-shell.tsx` — new layout (P2)
- `src/components/viewer/video-player.tsx` — mount ChapterSegmentsOverlay (P2)
- `src/components/dashboard/recording-card-menu.tsx` — add Edit link
- `src/app/api/recordings/[id]/route.ts` — add PATCH for title rename (P3)
- `src/db/queries/recordings.ts` — add `updateRecordingTitle`, `updateRecordingBrand` (P3)

---

# PHASE 1 — Edit page foundation (no regression)

After Phase 1: owner has a new `/recordings/[id]/edit` page housing the existing OwnerToolbar (password / trim / downloads), DropoffChart, view count, and share URL. The share page loses those owner-only blocks. No visitor-facing visual change yet.

---

### Task 1.1: Add `getRecordingForEdit` query

**Files:**
- Modify: `src/db/queries/recordings.ts`

- [ ] **Step 1: Read existing query patterns**

Run: `grep -n "export async function" src/db/queries/recordings.ts`
Expected: list of `listRecordings`, `getRecordingBySlug`, `getRecordingOwned`, `softDeleteRecording`, `updateTrim`, `clearTrim`, plus folder-related.

- [ ] **Step 2: Append a new query that returns the same `RecordingWithBrand` shape but keyed by id + ownerId**

Append to `src/db/queries/recordings.ts`:

```ts
export async function getRecordingForEdit(
  id: string,
  ownerId: string
): Promise<RecordingWithBrand | null> {
  const [row] = await db
    .select({
      rec: mediaObjects,
      brandId: brandProfiles.id,
      brandName: brandProfiles.name,
      brandAccent: brandProfiles.accentColor,
      brandLogoUrl: brandProfiles.logoUrl,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(
      and(
        eq(mediaObjects.id, id),
        eq(mediaObjects.ownerId, ownerId),
        isNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);

  if (!row) return null;
  const { countViews } = await import("@/db/queries/views");
  const viewCount = await countViews(row.rec.id);
  return {
    ...row.rec,
    brand: row.brandId
      ? {
          id: row.brandId,
          name: row.brandName!,
          accentColor: row.brandAccent!,
          logoUrl: row.brandLogoUrl ?? null,
        }
      : null,
    aiTitle: row.aiTitle,
    aiSummary: row.aiSummary,
    aiChapters: row.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: row.aiActionItems as RecordingWithBrand["aiActionItems"],
    viewCount,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/db/queries/recordings.ts
git commit -m "feat(db): getRecordingForEdit owner-scoped query for /recordings/[id]/edit"
```

---

### Task 1.2: Scaffold `/recordings/[id]/edit` server route

**Files:**
- Create: `src/app/recordings/[id]/edit/page.tsx`

- [ ] **Step 1: Create the page with auth + ownership guard, returning a placeholder shell**

Write `src/app/recordings/[id]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingForEdit } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { listMaxWatched, countViews } from "@/db/queries/views";
import { presignGet } from "@/lib/r2/presigned-get";
import { bucketize } from "@/lib/viewer/dropoff";
import { OwnerToolbar } from "@/components/viewer/owner-toolbar";
import { DropoffChart } from "@/components/viewer/dropoff-chart";
import { CopyLinkButton } from "@/components/share/copy-link-button";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function EditRecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const { id } = await params;
  const rec = await getRecordingForEdit(id, user.id);
  if (!rec) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const shareUrl = `${appUrl}/v/${rec.slug}`;

  const trimStartSec =
    rec.trimStartSec != null ? parseFloat(String(rec.trimStartSec)) : null;
  const trimEndSec =
    rec.trimEndSec != null ? parseFloat(String(rec.trimEndSec)) : null;

  const downloadKinds: Array<{ kind: string; key: string | null; fileKind: string }> = [
    { kind: "Composite", key: rec.r2CompositeKey, fileKind: "composite" },
    { kind: "Screen", key: rec.r2ScreenKey, fileKind: "screen" },
    { kind: "Camera", key: rec.r2CameraKey, fileKind: "camera" },
    { kind: "Mic", key: rec.r2MicKey, fileKind: "mic" },
    { kind: "System audio", key: rec.r2SystemaudioKey, fileKind: "systemaudio" },
  ];
  const downloads = await Promise.all(
    downloadKinds
      .filter((d) => !!d.key)
      .map(async (d) => ({
        kind: d.kind,
        href: await presignGet(d.key!, {
          filename: `${rec.slug}-${d.fileKind}.webm`,
        }),
      }))
  );

  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  let dropoffBuckets: number[] | null = null;
  let viewCount = 0;
  if (isReady) {
    const durationSec = parseFloat(String(rec.durationSeconds ?? "0"));
    const maxList = await listMaxWatched(rec.id);
    dropoffBuckets = bucketize(maxList, durationSec, 10);
    viewCount = await countViews(rec.id);
  }

  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>
        <Link
          href={`/v/${rec.slug}`}
          target="_blank"
          className="text-sm text-text-muted hover:text-text"
        >
          View public page →
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          {displayTitle}
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Status: {rec.status}
          {viewCount > 0 && (
            <>
              {" · "}
              {viewCount} view{viewCount === 1 ? "" : "s"}
            </>
          )}
        </p>

        <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-bg-subtle p-3">
          <code className="flex-1 truncate rounded-md bg-bg-elevated px-3 py-2 font-mono text-xs text-text-muted">
            {shareUrl}
          </code>
          <CopyLinkButton url={shareUrl} />
        </div>

        <OwnerToolbar
          recordingId={rec.id}
          hasPassword={!!rec.passwordHash}
          durationSec={
            rec.durationSeconds != null
              ? parseFloat(String(rec.durationSeconds))
              : null
          }
          trimStartSec={trimStartSec}
          trimEndSec={trimEndSec}
          downloads={downloads}
        />

        {dropoffBuckets && <DropoffChart buckets={dropoffBuckets} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Manual smoke (dev server)**

Start the dev server in another terminal: `npm run dev`. Sign in. Visit `/recordings/<some-real-id>/edit`. Confirm: page renders, password/trim/downloads/dropoff are all present. Visit `/recordings/<an-id-you-don't-own>/edit` → expect 404. Sign out → expect redirect to login.

- [ ] **Step 4: Commit**

```bash
git add src/app/recordings/[id]/edit/page.tsx
git commit -m "feat(edit): scaffold /recordings/[id]/edit (lifts owner toolbar wholesale)"
```

---

### Task 1.3: E2E test for edit page auth + ownership

**Files:**
- Create: `tests/e2e/edit-page.spec.ts`

- [ ] **Step 1: Write the failing test**

Read existing e2e patterns first:

Run: `cat tests/e2e/recordings-list.spec.ts | head -40`

Then write `tests/e2e/edit-page.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL!;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

test.describe("/recordings/[id]/edit", () => {
  test.skip(!TEST_EMAIL || !TEST_PASSWORD, "TEST_CREATOR_* env vars not set");

  test("anon redirects to login", async ({ page }) => {
    await page.goto(`${APP_URL}/recordings/00000000-0000-0000-0000-000000000000/edit`);
    await expect(page).toHaveURL(/\/login/);
  });

  test("owner sees the edit shell on a real recording", async ({ page }) => {
    await page.goto(`${APP_URL}/login`);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${APP_URL}/`);

    // Pick the first recording card and visit its edit page via the dashboard menu.
    const firstCard = page.locator('a[href^="/v/"]').first();
    await expect(firstCard).toBeVisible();
    const href = await firstCard.getAttribute("href");
    expect(href).toBeTruthy();

    // Derive the id by visiting the share page and reading the Edit pill href.
    // Phase 1 also adds the dashboard menu Edit link (Task 1.5); this test
    // uses direct navigation via the recording id to avoid coupling to the menu.
    // Discover the id from a server-rendered fragment if available, or skip if not.
    // Simplest path: visit dashboard and read data-id attribute on the card.
    const cardWithId = page.locator("[data-recording-id]").first();
    const id = await cardWithId.getAttribute("data-recording-id");
    expect(id).toBeTruthy();

    await page.goto(`${APP_URL}/recordings/${id}/edit`);
    await expect(page.getByRole("link", { name: /Dashboard/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /View public page/i })).toBeVisible();
    await expect(page.getByText(/Status:/)).toBeVisible();
  });

  test("non-owner gets 404", async ({ page }) => {
    await page.goto(`${APP_URL}/login`);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${APP_URL}/`);

    // Random UUID the user does not own.
    const fakeId = "11111111-2222-3333-4444-555555555555";
    const res = await page.goto(`${APP_URL}/recordings/${fakeId}/edit`);
    expect(res?.status()).toBe(404);
  });
});
```

- [ ] **Step 2: Add `data-recording-id` to RecordingCard**

The test reads `[data-recording-id]` from the dashboard. Add it to the card:

Run: `grep -n "Link" src/components/dashboard/recording-card.tsx | head -5`

Then in `src/components/dashboard/recording-card.tsx`, find the outer `<Link>` and add:

```tsx
<Link
  href={`/v/${rec.slug}`}
  data-recording-id={rec.id}
  // ...existing props
>
```

(The exact Edit will depend on file contents — preserve all current attributes; just add the `data-recording-id` prop.)

- [ ] **Step 3: Run the test**

Run: `npm run test:e2e -- edit-page.spec.ts`
Expected: tests pass when the dev server is up and `TEST_CREATOR_*` env vars are set; otherwise skipped.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/edit-page.spec.ts src/components/dashboard/recording-card.tsx
git commit -m "test(edit): e2e auth + ownership coverage for /recordings/[id]/edit"
```

---

### Task 1.4: Strip owner-only blocks from `/v/:slug` page

**Files:**
- Modify: `src/app/v/[slug]/page.tsx`

- [ ] **Step 1: Remove the OwnerToolbar render and the downloads fetch**

In `src/app/v/[slug]/page.tsx`:

1. Delete the `downloads` computation (the `await Promise.all(downloadKinds...)` block — lines around 86-104).
2. Delete the `<OwnerToolbar ... />` JSX (around lines 149-162).
3. Delete the `presignGet` import if it becomes unused. (Actually keep — `signedVideoUrl` still uses it.)
4. Delete the `OwnerToolbar` import.
5. Delete the `DropoffChart` import and JSX.
6. Delete the `dropoffBuckets` and `viewCount` computations and their `if (isOwner && isReady)` guard.
7. Delete the share-URL block at the bottom (the `<div className="mt-10 flex items-center gap-3...">` with `<CopyLinkButton>`).
8. Delete the `CopyLinkButton` import.
9. Simplify the meta `<p>`: remove the `{isOwner && isReady && viewCount > 0 && ...}` clause. Keep just `{isReady ? "Ready" : `Status: ${rec.status}`}`.
10. Delete `listMaxWatched`, `countViews`, `bucketize` imports (now unused on this page).

- [ ] **Step 2: Verify it still compiles and renders**

Run: `npm run typecheck`
Expected: passes (no unused imports).

Run: `npm run dev` and visit `/v/<some-slug>` while signed in as owner. Confirm: title, status, summary, video, transcript, chapters, actions, comments are all there. Owner-only stuff is gone.

- [ ] **Step 3: Commit**

```bash
git add src/app/v/[slug]/page.tsx
git commit -m "refactor(viewer): drop owner-only blocks from /v/:slug (moved to edit page)"
```

---

### Task 1.5: Add Edit pill to BrandHeader and Edit link to dashboard menu

**Files:**
- Modify: `src/app/v/[slug]/page.tsx`
- Modify: `src/components/dashboard/recording-card-menu.tsx`

- [ ] **Step 1: Update `BrandHeader` in `src/app/v/[slug]/page.tsx` to accept an optional `recordingId` and render an Edit pill when owner**

Replace the `BrandHeader` function and its usage:

```tsx
function BrandHeader({
  brandName,
  brandLogoUrl,
  accent,
  isOwner,
  recordingId,
}: {
  brandName?: string | null;
  brandLogoUrl?: string | null;
  accent: string | null;
  isOwner: boolean;
  recordingId?: string;
}) {
  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          {brandLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brandLogoUrl}
              alt={brandName ?? ""}
              className="h-6 w-auto"
            />
          )}
          {brandName && (
            <span className="text-sm font-semibold text-text">{brandName}</span>
          )}
        </div>
        {isOwner && recordingId && (
          <div className="flex items-center gap-3">
            <Link
              href={`/recordings/${recordingId}/edit`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1 text-xs text-text-muted hover:border-accent hover:text-text"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
          </div>
        )}
      </header>
      {accent && (
        <div className="h-[2px] w-full" style={{ backgroundColor: accent }} />
      )}
    </>
  );
}
```

Then update both call sites (the locked / unlocked branches) to pass `recordingId={rec.id}`:

```tsx
<BrandHeader
  brandName={rec.brand?.name}
  brandLogoUrl={rec.brand?.logoUrl}
  accent={accent}
  isOwner={isOwner}
  recordingId={rec.id}
/>
```

Add `Pencil` to the `lucide-react` import:

```tsx
import { ArrowLeft, Pencil } from "lucide-react";
```

- [ ] **Step 2: Add Edit link to dashboard recording-card menu**

In `src/components/dashboard/recording-card-menu.tsx`, find the menu's "default" branch (the `else` containing "Move to folder" and "Delete"). Add an Edit item at the top:

```tsx
import Link from "next/link";
import { MoreHorizontal, Trash2, FolderInput, Pencil } from "lucide-react";
// ... existing imports
```

Inside the `else` block (the non-`showMove` branch), add as the first menu item:

```tsx
<Link
  href={`/recordings/${recordingId}/edit`}
  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-text-muted hover:bg-bg-subtle hover:text-text"
  onClick={() => setOpen(false)}
>
  <Pencil className="h-3.5 w-3.5" />
  Edit
</Link>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: passes.

Manually: visit `/v/<slug>` as owner → see Edit pill in header → click → land on edit page. Visit dashboard → click ⋯ on a card → see Edit option → click → land on edit page.

- [ ] **Step 4: Commit**

```bash
git add src/app/v/[slug]/page.tsx src/components/dashboard/recording-card-menu.tsx
git commit -m "feat(nav): Edit pill on /v/:slug for owner + Edit menu item on dashboard card"
```

---

### Task 1.6: Phase 1 smoke + push

**Files:**
- (none — verification only)

- [ ] **Step 1: Run unit tests**

Run: `npm run test`
Expected: all existing tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: passes.

- [ ] **Step 4: Manual end-to-end check**

In a browser (dev server running):
1. Sign in as owner.
2. Dashboard: ⋯ → Edit on a card → land on edit page → see toolbar + drop-off + share URL.
3. From the edit page, change the password (Add password → 1234 → Save). Verify network 200, page refreshes, password chip shows "on."
4. Click "View public page" → land on `/v/:slug` → see Edit pill in the header. Owner-only blocks (toolbar, dropoff, share URL) are NOT visible on this page.
5. From `/v/:slug`, click the Edit pill → return to edit page.
6. Sign out → visit `/v/:slug` of a public recording → confirm visitor sees the same view (no Edit pill, no owner blocks).

- [ ] **Step 5: Push to deploy**

```bash
git push
```

(Coolify auto-deploys on push to `main`.)

---

# PHASE 2 — Share page redesign

After Phase 2: `/v/:slug` has chapter segments painted on the seekbar, AI summary as a calm caption under the player, action items hidden when empty, chapters list, and a `Transcript · Comments` tab strip. The visual upgrade is shipped.

---

### Task 2.1: ChapterSegmentsOverlay — math unit test (TDD red)

**Files:**
- Create: `tests/unit/chapter-segments.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { computeSegments } from "@/components/viewer/chapter-segments";

describe("computeSegments", () => {
  it("returns empty array when no chapters", () => {
    expect(computeSegments([], 100)).toEqual([]);
  });

  it("returns full-width single segment for one chapter", () => {
    const segs = computeSegments([{ start_sec: 0, title: "Intro" }], 60);
    expect(segs).toHaveLength(1);
    expect(segs[0].leftPct).toBe(0);
    expect(segs[0].widthPct).toBeCloseTo(100, 5);
    expect(segs[0].title).toBe("Intro");
  });

  it("computes left + width from start times and total duration", () => {
    const chapters = [
      { start_sec: 0, title: "A" },
      { start_sec: 30, title: "B" },
      { start_sec: 75, title: "C" },
    ];
    const segs = computeSegments(chapters, 100);
    expect(segs[0].leftPct).toBe(0);
    expect(segs[0].widthPct).toBeCloseTo(30, 5);
    expect(segs[1].leftPct).toBe(30);
    expect(segs[1].widthPct).toBeCloseTo(45, 5);
    expect(segs[2].leftPct).toBe(75);
    expect(segs[2].widthPct).toBeCloseTo(25, 5);
  });

  it("treats out-of-order chapters by sorting them by start_sec", () => {
    const chapters = [
      { start_sec: 30, title: "B" },
      { start_sec: 0, title: "A" },
    ];
    const segs = computeSegments(chapters, 60);
    expect(segs[0].title).toBe("A");
    expect(segs[1].title).toBe("B");
  });

  it("returns empty array when totalDuration is 0 or negative", () => {
    expect(computeSegments([{ start_sec: 0, title: "X" }], 0)).toEqual([]);
    expect(computeSegments([{ start_sec: 0, title: "X" }], -1)).toEqual([]);
  });

  it("clamps an out-of-range chapter start to the duration", () => {
    const chapters = [
      { start_sec: 0, title: "A" },
      { start_sec: 200, title: "B" },
    ];
    const segs = computeSegments(chapters, 100);
    // B's start is clamped to 100, producing zero width — so we drop it.
    expect(segs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- chapter-segments`
Expected: FAIL with "Cannot find module '@/components/viewer/chapter-segments'".

---

### Task 2.2: ChapterSegmentsOverlay — implementation

**Files:**
- Create: `src/components/viewer/chapter-segments.tsx`

- [ ] **Step 1: Implement `computeSegments` and the React component**

Write `src/components/viewer/chapter-segments.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

export type Chapter = { start_sec: number; title: string };

export type Segment = {
  leftPct: number;
  widthPct: number;
  start_sec: number;
  title: string;
};

export function computeSegments(
  chapters: Chapter[],
  totalDuration: number
): Segment[] {
  if (totalDuration <= 0 || chapters.length === 0) return [];
  const sorted = [...chapters].sort((a, b) => a.start_sec - b.start_sec);
  const segs: Segment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = Math.min(sorted[i].start_sec, totalDuration);
    const end = i + 1 < sorted.length
      ? Math.min(sorted[i + 1].start_sec, totalDuration)
      : totalDuration;
    const widthPct = ((end - start) / totalDuration) * 100;
    if (widthPct <= 0) continue;
    segs.push({
      leftPct: (start / totalDuration) * 100,
      widthPct,
      start_sec: sorted[i].start_sec,
      title: sorted[i].title,
    });
  }
  return segs;
}

type OverlayProps = {
  progressEl: HTMLElement | null;
  chapters: Chapter[];
  totalDuration: number;
  currentTime: number;
  onSeek: (sec: number) => void;
};

/**
 * Paints chapter segments on top of Plyr's `.plyr__progress` element.
 * Renders a list of absolutely-positioned buttons, one per segment.
 * `progressEl` is the element returned by Plyr; we apply our overlay
 * via React portal-style positioning (we keep our own wrapper div
 * mounted as a sibling, sized to match).
 */
export function ChapterSegmentsOverlay({
  progressEl,
  chapters,
  totalDuration,
  currentTime,
  onSeek,
}: OverlayProps) {
  const [, forceTick] = useState(0);

  // Re-measure on resize so segments stay aligned with Plyr's progress bar.
  useEffect(() => {
    if (!progressEl) return;
    const onResize = () => forceTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(progressEl);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, [progressEl]);

  if (!progressEl || totalDuration <= 0) return null;
  const segments = computeSegments(chapters, totalDuration);
  if (segments.length === 0) return null;

  const rect = progressEl.getBoundingClientRect();

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
        pointerEvents: "none",
        display: "flex",
        gap: "1px",
      }}
    >
      {segments.map((seg, i) => {
        const segEnd = seg.start_sec + (seg.widthPct / 100) * totalDuration;
        const played = currentTime >= segEnd;
        const current =
          currentTime >= seg.start_sec && currentTime < segEnd;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSeek(seg.start_sec)}
            title={seg.title}
            style={{
              flex: `${seg.widthPct} 0 0`,
              height: "100%",
              background: played
                ? "var(--accent)"
                : current
                ? "color-mix(in srgb, var(--accent) 70%, transparent)"
                : "rgba(255,255,255,0.20)",
              border: "none",
              padding: 0,
              cursor: "pointer",
              pointerEvents: "auto",
              borderRadius: "1px",
            }}
            aria-label={`Chapter: ${seg.title}`}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run the unit test to confirm it passes**

Run: `npm run test -- chapter-segments`
Expected: PASS (all 6 cases).

- [ ] **Step 3: Commit**

```bash
git add src/components/viewer/chapter-segments.tsx tests/unit/chapter-segments.test.ts
git commit -m "feat(viewer): ChapterSegmentsOverlay component + computeSegments unit tests"
```

---

### Task 2.3: Wire ChapterSegmentsOverlay into VideoPlayer

**Files:**
- Modify: `src/components/viewer/video-player.tsx`

- [ ] **Step 1: Track Plyr's progress element and currentTime in state, render the overlay**

In `src/components/viewer/video-player.tsx`:

1. Replace the `ChapterSegmentsOverlay` import block (top of file):

```tsx
import { ChapterSegmentsOverlay } from "./chapter-segments";
```

2. Add two pieces of state inside the component:

```tsx
const [progressEl, setProgressEl] = useState<HTMLElement | null>(null);
const [currentTime, setCurrentTime] = useState(0);
```

3. Inside the existing `plyrRef.current.on("ready", ...)` callback, capture the progress element:

```tsx
plyrRef.current.on("ready", () => {
  onReady?.();
  // Plyr exposes its DOM via player.elements.progress
  const el = plyrRef.current?.elements?.progress as HTMLElement | undefined;
  if (el) setProgressEl(el);
});
```

4. Update the `timeupdate` handler to also update `currentTime` state for the overlay:

```tsx
plyrRef.current.on("timeupdate", () => {
  const t = plyrRef.current?.currentTime ?? 0;
  setCurrentTime(t);
  if (
    typeof trimEndSec === "number" &&
    trimEndSec > 0 &&
    t >= trimEndSec
  ) {
    plyrRef.current?.pause();
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, trimEndSec - 0.05);
    }
    onTimeUpdate(trimEndSec);
    return;
  }
  onTimeUpdate(t);
});
```

5. Replace the `markers` Plyr config — Plyr's native point markers are no longer used since segments cover this:

```tsx
plyrRef.current = new Plyr(videoRef.current, {});
```

6. Compute total duration from videoRef once metadata is loaded. Add state:

```tsx
const [totalDuration, setTotalDuration] = useState(0);
```

7. Inside the `loadedmetadata` handler:

```tsx
plyrRef.current.on("loadedmetadata", () => {
  const dur = videoRef.current?.duration ?? 0;
  if (isFinite(dur) && dur > 0) setTotalDuration(dur);
  if (
    typeof trimStartSec === "number" &&
    trimStartSec > 0 &&
    (plyrRef.current?.currentTime ?? 0) < trimStartSec &&
    videoRef.current
  ) {
    videoRef.current.currentTime = trimStartSec;
  }
});
```

8. After the `<video>` element in the JSX, render the overlay. Add a `seek` handler that maps to the existing seek logic:

```tsx
return (
  <div className="plyr-wrapper" style={{ ["--plyr-color-main" as never]: accentColor }}>
    <video
      ref={videoRef}
      src={initialSignedUrl}
      controls
      playsInline
      preload="metadata"
      onError={handleError}
      className="w-full rounded-xl border border-border bg-black"
    />
    <ChapterSegmentsOverlay
      progressEl={progressEl}
      chapters={chapters}
      totalDuration={totalDuration}
      currentTime={currentTime}
      onSeek={(sec) => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = sec;
        if (plyrRef.current) plyrRef.current.currentTime = sec;
      }}
    />
    {error && (
      <div className="mt-2 flex items-center gap-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
        <span className="opacity-80">Playback interrupted ({error}).</span>
        <button
          onClick={() => void refreshUrl()}
          className="rounded bg-red-500/80 px-2 py-1 text-xs text-white"
        >
          Retry
        </button>
      </div>
    )}
  </div>
);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Manual verification**

`npm run dev` → visit a recording with chapters → confirm:
- Chapter segments appear painted across Plyr's seekbar (one stripe per chapter).
- Hovering shows the chapter title (native `title` attribute tooltip).
- Clicking a segment seeks to that chapter.
- Played segments are accent-colored; current segment is partially filled; unplayed are muted.
- Resize the window — segments stay aligned.

**If the overlay fails to align with Plyr's progress** (Plyr doesn't expose `elements.progress`, or the element is wrapped weirdly), fallback: keep the existing `markers` config from before, and skip the overlay.

- [ ] **Step 4: Commit**

```bash
git add src/components/viewer/video-player.tsx
git commit -m "feat(viewer): paint Loom-style chapter segments on Plyr seekbar"
```

---

### Task 2.4: SummaryBlock + ActionItemsBlock components

**Files:**
- Create: `src/components/viewer/summary-block.tsx`
- Create: `src/components/viewer/action-items-block.tsx`

- [ ] **Step 1: Write `SummaryBlock`**

Write `src/components/viewer/summary-block.tsx`:

```tsx
export function SummaryBlock({ summary }: { summary: string | null | undefined }) {
  if (!summary) return null;
  return (
    <p className="mt-8 max-w-[75ch] text-[15.5px] leading-[1.7] text-text-muted">
      {summary}
    </p>
  );
}
```

- [ ] **Step 2: Write `ActionItemsBlock`**

Write `src/components/viewer/action-items-block.tsx`:

```tsx
"use client";

import { Check } from "lucide-react";

type ActionItem = { timestamp_sec: number; text: string };

function formatTs(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

export function ActionItemsBlock({
  actionItems,
  onSeek,
}: {
  actionItems: ActionItem[];
  onSeek: (sec: number) => void;
}) {
  if (actionItems.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
        Action items
      </h2>
      <ul className="mt-3 space-y-1.5">
        {actionItems.map((item, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSeek(item.timestamp_sec)}
              className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-[14px] text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
            >
              <Check className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-accent" />
              <span className="flex-1">{item.text}</span>
              <code className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-subtle">
                {formatTs(item.timestamp_sec)}
              </code>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/viewer/summary-block.tsx src/components/viewer/action-items-block.tsx
git commit -m "feat(viewer): SummaryBlock + ActionItemsBlock components"
```

---

### Task 2.5: ContentTabs component

**Files:**
- Create: `src/components/viewer/content-tabs.tsx`

- [ ] **Step 1: Write the component**

Write `src/components/viewer/content-tabs.tsx`:

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";

type TabKey = "transcript" | "comments";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "transcript", label: "Transcript" },
  { key: "comments", label: "Comments" },
];

export function ContentTabs({
  transcript,
  comments,
}: {
  transcript: ReactNode;
  comments: ReactNode;
}) {
  const [active, setActive] = useState<TabKey>("transcript");

  // Hydrate from URL ?tab=... on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("tab");
    if (fromUrl === "transcript" || fromUrl === "comments") {
      setActive(fromUrl);
    }
  }, []);

  function selectTab(next: TabKey) {
    setActive(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState({}, "", url.toString());
    }
  }

  return (
    <div className="mt-12">
      <div role="tablist" className="flex gap-6 border-b border-border">
        {TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => selectTab(t.key)}
              className={
                "relative -mb-px py-3 text-sm transition-colors " +
                (isActive
                  ? "text-text"
                  : "text-text-muted hover:text-text")
              }
            >
              {t.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 h-px w-full bg-text" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-6">
        {active === "transcript" ? transcript : comments}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/viewer/content-tabs.tsx
git commit -m "feat(viewer): ContentTabs component (Transcript · Comments, ?tab= URL state)"
```

---

### Task 2.6: Refactor ViewerShell to the new layout

**Files:**
- Modify: `src/components/viewer/viewer-shell.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the contents of `src/components/viewer/viewer-shell.tsx`:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import { ChaptersList } from "./chapters-list";
import { SummaryBlock } from "./summary-block";
import { ActionItemsBlock } from "./action-items-block";
import { ContentTabs } from "./content-tabs";
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
  summary: string | null | undefined;
  chapters: Array<{ start_sec: number; title: string }>;
  actionItems: Array<{ timestamp_sec: number; text: string }>;
  words: Word[];
  fullText: string;
  isOwner: boolean;
  comments: CommentRow[];
  trimStartSec: number | null;
  trimEndSec: number | null;
};

export function ViewerShell({
  slug,
  signedVideoUrl,
  accentColor,
  summary,
  chapters,
  actionItems,
  words,
  fullText,
  isOwner,
  comments,
  trimStartSec,
  trimEndSec,
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
        trimStartSec={trimStartSec}
        trimEndSec={trimEndSec}
      />
      {!isOwner && (
        <Tracking
          slug={slug}
          isPlaying={isPlaying}
          getCurrentTime={getCurrentTime}
        />
      )}

      <SummaryBlock summary={summary} />
      <ActionItemsBlock actionItems={actionItems} onSeek={handleSeek} />
      <ChaptersList chapters={chapters} onSeek={handleSeek} />

      <ContentTabs
        transcript={
          <TranscriptPanel
            words={words}
            fullText={fullText}
            currentTime={currentTime}
            onSeek={handleSeek}
          />
        }
        comments={
          <CommentsSection
            comments={comments}
            slug={slug}
            isOwner={isOwner}
            onSeek={handleSeek}
            getCurrentTime={getCurrentTime}
          />
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Update `src/app/v/[slug]/page.tsx` to pass `summary` to `ViewerShell` and remove the standalone summary `<p>`**

In `src/app/v/[slug]/page.tsx`:

1. Delete the `{rec.aiSummary && (<p>...)}` block — `SummaryBlock` inside `ViewerShell` now owns rendering.
2. Pass `summary={rec.aiSummary}` to `<ViewerShell>`.
3. Bump page padding from `py-10` to `py-14`.
4. Bump title from `text-2xl` to `text-[28px]`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Manual verification**

`npm run dev` → visit `/v/<slug>`:
- Title is larger; outer page has more breathing room.
- Player renders with chapter segments.
- Below: AI summary as a calm caption.
- Action items list (if any).
- Chapters list (timestamp + title).
- Tab strip: `Transcript` (default) · `Comments`. Click Comments → switches.
- URL updates to `?tab=comments` on click (replaceState).
- Click a transcript paragraph → player seeks.
- Comment deep-link `#t=120` from email still works (player seeks to 2:00 on load).

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/viewer-shell.tsx src/app/v/[slug]/page.tsx
git commit -m "feat(viewer): refactor ViewerShell to title→player→summary→actions→chapters→tabs"
```

---

### Task 2.7: E2E test for share page redesign

**Files:**
- Create: `tests/e2e/share-page.spec.ts`

- [ ] **Step 1: Write the test**

Write `tests/e2e/share-page.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL!;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD!;

test.describe("/v/:slug share page", () => {
  test.skip(!TEST_EMAIL || !TEST_PASSWORD, "TEST_CREATOR_* env vars not set");

  test("renders title, summary, chapter list, and tabs default to Transcript", async ({ page }) => {
    // Sign in to get to a recording we own.
    await page.goto(`${APP_URL}/login`);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${APP_URL}/`);

    const firstCard = page.locator('a[href^="/v/"]').first();
    await expect(firstCard).toBeVisible();
    const href = await firstCard.getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(`${APP_URL}${href}`);

    // Header
    await expect(page.locator("h1")).toBeVisible();
    // Player
    await expect(page.locator("video")).toBeVisible();
    // Tabs default to Transcript
    const transcriptTab = page.getByRole("tab", { name: "Transcript" });
    const commentsTab = page.getByRole("tab", { name: "Comments" });
    await expect(transcriptTab).toHaveAttribute("aria-selected", "true");
    await expect(commentsTab).toHaveAttribute("aria-selected", "false");
    // Click Comments → URL updates and Comments panel shows
    await commentsTab.click();
    await expect(commentsTab).toHaveAttribute("aria-selected", "true");
    expect(page.url()).toContain("tab=comments");
  });

  test("owner sees Edit pill in brand header, visitor does not", async ({ page, context }) => {
    await page.goto(`${APP_URL}/login`);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${APP_URL}/`);

    const href = await page.locator('a[href^="/v/"]').first().getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(`${APP_URL}${href}`);
    await expect(page.getByRole("link", { name: /Edit/ })).toBeVisible();

    // Anonymous context — same URL, no Edit pill.
    const anon = await context.browser()!.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`${APP_URL}${href}`);
    await expect(anonPage.getByRole("link", { name: /Edit/ })).toHaveCount(0);
    await anon.close();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:e2e -- share-page.spec.ts`
Expected: passes when dev server is up + env vars set.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/share-page.spec.ts
git commit -m "test(viewer): e2e for share-page tabs + owner Edit pill visibility"
```

---

### Task 2.8: Phase 2 smoke + push

- [ ] **Step 1: Tests + typecheck + lint**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 2: Manual verification across viewport sizes**

`npm run dev` → check `/v/<slug>` on:
- 1440px desktop — generous margins, segments visible
- 1024px tablet — still a single column, all sections render
- 600px mobile — page is responsive (no horizontal scroll), tabs collapse if needed

- [ ] **Step 3: Push**

```bash
git push
```

---

# PHASE 3 — Edit page polish

After Phase 3: edit page has inline title rename, brand picker, redesigned drop-off chart (filled-area SVG), delete confirmation modal, and a clean section-based layout with sticky preview.

---

### Task 3.1: `updateRecordingTitle` + `updateRecordingBrand` queries (TDD red)

**Files:**
- Create: `tests/unit/recording-update.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("updateRecordingTitle / updateRecordingBrand signatures", () => {
  it("updateRecordingTitle exists and is async", async () => {
    const mod = await import("@/db/queries/recordings");
    expect(typeof mod.updateRecordingTitle).toBe("function");
  });
  it("updateRecordingBrand exists and is async", async () => {
    const mod = await import("@/db/queries/recordings");
    expect(typeof mod.updateRecordingBrand).toBe("function");
  });
});
```

(This is a smoke / contract test — db queries are exercised by integration smoke (`npm run smoke`), not by unit tests.)

- [ ] **Step 2: Run the test → confirm fail**

Run: `npm run test -- recording-update`
Expected: FAIL — "updateRecordingTitle is undefined".

---

### Task 3.2: Implement `updateRecordingTitle` + `updateRecordingBrand`

**Files:**
- Modify: `src/db/queries/recordings.ts`

- [ ] **Step 1: Append to `src/db/queries/recordings.ts`**

```ts
export async function updateRecordingTitle(params: {
  id: string;
  ownerId: string;
  title: string;
}): Promise<boolean> {
  const trimmed = params.title.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  const result = await db
    .update(mediaObjects)
    .set({ title: trimmed, updatedAt: sql`now()` })
    .where(
      and(
        eq(mediaObjects.id, params.id),
        eq(mediaObjects.ownerId, params.ownerId)
      )
    )
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}

export async function updateRecordingBrand(params: {
  id: string;
  ownerId: string;
  brandProfileId: string | null;
}): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({ brandProfileId: params.brandProfileId, updatedAt: sql`now()` })
    .where(
      and(
        eq(mediaObjects.id, params.id),
        eq(mediaObjects.ownerId, params.ownerId)
      )
    )
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}
```

- [ ] **Step 2: Re-run unit test → confirm pass**

Run: `npm run test -- recording-update`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/recordings.ts tests/unit/recording-update.test.ts
git commit -m "feat(db): updateRecordingTitle + updateRecordingBrand queries"
```

---

### Task 3.3: PATCH endpoints for title and brand

**Files:**
- Modify: `src/app/api/recordings/[id]/route.ts`
- Create: `src/app/api/recordings/[id]/brand/route.ts`

- [ ] **Step 1: Add PATCH to `src/app/api/recordings/[id]/route.ts`**

Append to the existing route file:

```ts
import { z } from "zod";
import { updateRecordingTitle } from "@/db/queries/recordings";

const titleSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = titleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_title" }, { status: 400 });
  }
  const ok = await updateRecordingTitle({
    id,
    ownerId: user.id,
    title: parsed.data.title,
  });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create `src/app/api/recordings/[id]/brand/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { updateRecordingBrand } from "@/db/queries/recordings";

const brandSchema = z.object({
  brandProfileId: z.string().uuid().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = brandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_brand" }, { status: 400 });
  }
  const ok = await updateRecordingBrand({
    id,
    ownerId: user.id,
    brandProfileId: parsed.data.brandProfileId,
  });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/recordings/[id]/route.ts src/app/api/recordings/[id]/brand/route.ts
git commit -m "feat(api): PATCH /api/recordings/:id (title) + /api/recordings/:id/brand"
```

---

### Task 3.4: Drop-off chart redesign — math test (TDD red)

**Files:**
- Create: `tests/unit/dropoff-chart-path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildDropoffPath } from "@/components/edit/dropoff-chart";

describe("buildDropoffPath", () => {
  it("returns empty path for empty buckets", () => {
    expect(buildDropoffPath([], 100, 40)).toBe("");
  });

  it("returns a closed area path with N+1 points (one per bucket plus a close)", () => {
    const path = buildDropoffPath([5, 4, 3, 2, 1], 100, 40);
    // Should start with M, end with Z, contain L commands.
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect((path.match(/L /g) ?? []).length).toBeGreaterThan(0);
  });

  it("scales y by max bucket value (highest bucket reaches y=0)", () => {
    const path = buildDropoffPath([0, 10, 5], 60, 30);
    // 10 is the max. Bucket index 1 should be y=0 (top of chart). Path
    // includes a y=0 token somewhere.
    expect(path).toMatch(/[MmLl]\s*\d+(?:\.\d+)?\s+0(?!\d)/);
  });
});
```

- [ ] **Step 2: Run → confirm fail**

Run: `npm run test -- dropoff-chart-path`
Expected: FAIL — "Cannot find module '@/components/edit/dropoff-chart'".

---

### Task 3.5: Drop-off chart redesign — implementation

**Files:**
- Create: `src/components/edit/dropoff-chart.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useMemo, useState } from "react";

export function buildDropoffPath(
  buckets: number[],
  width: number,
  height: number
): string {
  if (buckets.length === 0) return "";
  const max = Math.max(1, ...buckets);
  const stepX = width / (buckets.length - 1 || 1);
  const points = buckets.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * height;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  // Filled area: M(0,height) L(p0) L(p1) ... L(width,height) Z
  return `M 0 ${height} L ${points.join(" L ")} L ${width.toFixed(1)} ${height} Z`;
}

export function buildDropoffLine(
  buckets: number[],
  width: number,
  height: number
): string {
  if (buckets.length === 0) return "";
  const max = Math.max(1, ...buckets);
  const stepX = width / (buckets.length - 1 || 1);
  const points = buckets.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * height;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
}

export function DropoffChart({ buckets }: { buckets: number[] }) {
  const total = buckets.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...buckets);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 600;
  const H = 80;
  const pathArea = useMemo(() => buildDropoffPath(buckets, W, H), [buckets]);
  const pathLine = useMemo(() => buildDropoffLine(buckets, W, H), [buckets]);

  if (total === 0) {
    return (
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
          Viewer drop-off
        </h3>
        <div className="mt-3 flex h-20 items-center justify-center rounded-lg border border-border bg-bg-subtle">
          <p className="text-xs text-text-subtle">No views yet.</p>
        </div>
      </div>
    );
  }

  const stepX = W / (buckets.length - 1 || 1);
  const hoverPct =
    hoverIdx == null
      ? null
      : Math.round((hoverIdx / (buckets.length - 1)) * 100);

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
        Viewer drop-off{" "}
        <span className="text-text-subtle normal-case tracking-normal">
          ({total} views)
        </span>
      </h3>
      <div className="mt-3 rounded-lg border border-border bg-bg-subtle p-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-20 w-full"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <path d={pathArea} fill="var(--accent)" fillOpacity="0.18" />
          <path
            d={pathLine}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {buckets.map((_, i) => (
            <rect
              key={i}
              x={Math.max(0, i * stepX - stepX / 2)}
              y={0}
              width={stepX}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}
          {hoverIdx != null && (
            <line
              x1={hoverIdx * stepX}
              x2={hoverIdx * stepX}
              y1={0}
              y2={H}
              stroke="var(--text-subtle)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
            />
          )}
        </svg>
        <div className="mt-2 flex items-center justify-between text-[11px] text-text-subtle">
          <span>0%</span>
          {hoverIdx != null && (
            <span className="text-text-muted">
              At {hoverPct}% — {buckets[hoverIdx]} viewer
              {buckets[hoverIdx] === 1 ? "" : "s"} (peak {max})
            </span>
          )}
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run → confirm pass**

Run: `npm run test -- dropoff-chart-path`
Expected: PASS (all 3 cases).

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/dropoff-chart.tsx tests/unit/dropoff-chart-path.test.ts
git commit -m "feat(edit): redesigned drop-off chart (filled-area SVG with hover)"
```

---

### Task 3.6: EditHeader — inline title rename + status + share URL + view-public link

**Files:**
- Create: `src/components/edit/edit-header.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/share/copy-link-button";

export function EditHeader({
  recordingId,
  slug,
  title,
  status,
  shareUrl,
}: {
  recordingId: string;
  slug: string;
  title: string;
  status: "uploading" | "transcribing" | "processing" | "ready" | "failed";
  shareUrl: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (draft.trim().length === 0 || draft === title) {
      setEditing(false);
      setDraft(title);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: draft }),
      });
      if (!res.ok) {
        setError(`Save failed (${res.status}).`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        {editing ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(title);
                setError(null);
              }
            }}
            disabled={busy}
            autoFocus
            className="text-2xl font-semibold tracking-tight"
          />
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              {title}
            </h1>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rename"
              onClick={() => {
                setDraft(title);
                setEditing(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </>
        )}
        <Badge variant={status}>{status}</Badge>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-bg-subtle p-3">
        <code className="flex-1 truncate rounded-md bg-bg-elevated px-3 py-2 font-mono text-xs text-text-muted">
          {shareUrl}
        </code>
        <CopyLinkButton url={shareUrl} />
        <Link
          href={`/v/${slug}`}
          target="_blank"
          className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-muted hover:border-accent hover:text-text"
        >
          View public →
        </Link>
      </div>
    </div>
  );
}
```

(`Badge`'s variants in `src/components/ui/badge.tsx` already match the recording status names — `ready`, `processing`, `transcribing`, `uploading`, `failed` — so passing `variant={status}` works without changes.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes (or surface a Badge variant mismatch, in which case adjust to use existing variants).

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/edit-header.tsx
git commit -m "feat(edit): EditHeader with inline title rename + status + share URL"
```

---

### Task 3.7: SettingsSection — brand picker + password

**Files:**
- Create: `src/components/edit/settings-section.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type BrandOption = { id: string; name: string };

export function SettingsSection({
  recordingId,
  hasPassword,
  brandProfileId,
  brandOptions,
}: {
  recordingId: string;
  hasPassword: boolean;
  brandProfileId: string | null;
  brandOptions: BrandOption[];
}) {
  const router = useRouter();
  const [openPwd, setOpenPwd] = useState(false);
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
      setOpenPwd(false);
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
      setOpenPwd(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function changeBrand(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/brand`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brandProfileId: value === "" ? null : value,
        }),
      });
      if (!res.ok) {
        setError(`Brand save failed (${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-text">Settings</h2>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-text-muted">Brand</span>
            <Select
              value={brandProfileId ?? ""}
              onChange={(e) => void changeBrand(e.target.value)}
              disabled={busy}
              className="ml-auto w-56"
            >
              <option value="">No brand</option>
              {brandOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm">
          <div className="flex items-center gap-3">
            {hasPassword ? (
              <Lock className="h-4 w-4 text-emerald-400" />
            ) : (
              <LockOpen className="h-4 w-4 text-text-subtle" />
            )}
            <span className="text-text-muted">Password</span>
            <span className={hasPassword ? "text-emerald-400" : "text-text-subtle"}>
              {hasPassword ? "on" : "off"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpenPwd(!openPwd);
                  setError(null);
                }}
              >
                {hasPassword ? "Change" : "Add password"}
              </Button>
              {hasPassword && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={removePassword}
                  disabled={busy}
                  aria-label="Remove password"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
          {openPwd && (
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={hasPassword ? "New password" : "Password"}
                className="flex-1"
              />
              <Button size="sm" onClick={savePassword} disabled={busy}>
                Save
              </Button>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes. (`Select` is a native `<select>` wrapper — `value` and `onChange` work as written.)

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/settings-section.tsx
git commit -m "feat(edit): SettingsSection (brand picker + password)"
```

---

### Task 3.8: DangerZone with delete confirmation

**Files:**
- Create: `src/components/edit/danger-zone.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DangerZone({
  recordingId,
  title,
}: {
  recordingId: string;
  title: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    if (typed !== title) {
      setError("Type the recording's title exactly to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`Delete failed (${res.status}).`);
        return;
      }
      router.push("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
      <p className="mt-1 text-xs text-text-muted">
        Deleting moves this recording to the trash bin (soft delete). The video
        files in R2 are kept until a future cleanup job.
      </p>
      {!confirm ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-destructive hover:bg-destructive/10"
          onClick={() => setConfirm(true)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete recording
        </Button>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-text-muted">
            Type <code className="rounded bg-bg-elevated px-1 py-0.5 text-text">{title}</code> to confirm.
          </p>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={title}
            disabled={busy}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirm(false);
                setTyped("");
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={doDelete}
              disabled={busy || typed !== title}
            >
              {busy ? "Deleting…" : "Permanently delete"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
```

(`Button` already has a `destructive` variant in `src/components/ui/button.tsx`, so no fallback needed.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/danger-zone.tsx
git commit -m "feat(edit): DangerZone with type-to-confirm delete"
```

---

### Task 3.9: PreviewPlayer — small Plyr instance for the edit page

**Files:**
- Create: `src/components/edit/preview-player.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import "plyr/dist/plyr.css";
import { useEffect, useRef } from "react";

export function PreviewPlayer({ signedUrl }: { signedUrl: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plyrRef = useRef<unknown>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    let cancelled = false;
    (async () => {
      const Plyr = (await import("plyr")).default;
      if (cancelled || !videoRef.current) return;
      plyrRef.current = new Plyr(videoRef.current);
    })();
    return () => {
      cancelled = true;
      // @ts-expect-error Plyr typing
      plyrRef.current?.destroy?.();
      plyrRef.current = null;
    };
  }, []);

  return (
    <div className="plyr-wrapper" style={{ ["--plyr-color-main" as never]: "var(--accent)" }}>
      <video
        ref={videoRef}
        src={signedUrl}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-xl border border-border bg-black"
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/preview-player.tsx
git commit -m "feat(edit): PreviewPlayer (small Plyr without chapter overlay)"
```

---

### Task 3.10: EditShell — sticky-preview two-column layout

**Files:**
- Create: `src/components/edit/edit-shell.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import type { ReactNode } from "react";

export function EditShell({
  preview,
  header,
  settings,
  trim,
  downloads,
  analytics,
  danger,
}: {
  preview: ReactNode;
  header: ReactNode;
  settings: ReactNode;
  trim: ReactNode;
  downloads: ReactNode;
  analytics: ReactNode;
  danger: ReactNode;
}) {
  return (
    <div>
      <div className="mb-8">{header}</div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          {preview}
        </aside>
        <div className="space-y-10">
          {settings}
          {trim}
          {downloads}
          {analytics}
          {danger}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/edit-shell.tsx
git commit -m "feat(edit): EditShell sticky-preview two-column layout"
```

---

### Task 3.11: Wire all the pieces into the edit page

**Files:**
- Modify: `src/app/recordings/[id]/edit/page.tsx`

- [ ] **Step 1: Replace the page contents**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingForEdit } from "@/db/queries/recordings";
import { listMaxWatched, countViews } from "@/db/queries/views";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { presignGet } from "@/lib/r2/presigned-get";
import { bucketize } from "@/lib/viewer/dropoff";
import { EditShell } from "@/components/edit/edit-shell";
import { EditHeader } from "@/components/edit/edit-header";
import { PreviewPlayer } from "@/components/edit/preview-player";
import { SettingsSection } from "@/components/edit/settings-section";
import { TrimEditor } from "@/components/viewer/trim-editor";
import { DownloadsList } from "@/components/viewer/downloads-list";
import { DropoffChart } from "@/components/edit/dropoff-chart";
import { DangerZone } from "@/components/edit/danger-zone";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function EditRecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const { id } = await params;
  const rec = await getRecordingForEdit(id, user.id);
  if (!rec) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const shareUrl = `${appUrl}/v/${rec.slug}`;

  const trimStartSec =
    rec.trimStartSec != null ? parseFloat(String(rec.trimStartSec)) : null;
  const trimEndSec =
    rec.trimEndSec != null ? parseFloat(String(rec.trimEndSec)) : null;

  const downloadKinds: Array<{ kind: string; key: string | null; fileKind: string }> = [
    { kind: "Composite", key: rec.r2CompositeKey, fileKind: "composite" },
    { kind: "Screen", key: rec.r2ScreenKey, fileKind: "screen" },
    { kind: "Camera", key: rec.r2CameraKey, fileKind: "camera" },
    { kind: "Mic", key: rec.r2MicKey, fileKind: "mic" },
    { kind: "System audio", key: rec.r2SystemaudioKey, fileKind: "systemaudio" },
  ];
  const downloads = await Promise.all(
    downloadKinds
      .filter((d) => !!d.key)
      .map(async (d) => ({
        kind: d.kind,
        href: await presignGet(d.key!, {
          filename: `${rec.slug}-${d.fileKind}.webm`,
        }),
      }))
  );

  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const signedVideoUrl = isReady ? await presignGet(rec.r2CompositeKey!) : null;

  let dropoffBuckets: number[] = [];
  let viewCount = 0;
  if (isReady) {
    const durationSec = parseFloat(String(rec.durationSeconds ?? "0"));
    const maxList = await listMaxWatched(rec.id);
    dropoffBuckets = bucketize(maxList, durationSec, 10);
    viewCount = await countViews(rec.id);
  }

  const brandOptions = await listBrandProfiles(user.id);
  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center border-b border-border px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <EditShell
          header={
            <EditHeader
              recordingId={rec.id}
              slug={rec.slug}
              title={displayTitle}
              status={rec.status}
              shareUrl={shareUrl}
            />
          }
          preview={
            signedVideoUrl ? (
              <>
                <PreviewPlayer signedUrl={signedVideoUrl} />
                <div className="mt-4 rounded-lg border border-border bg-bg-subtle p-3 text-xs text-text-muted">
                  <div>Views: <span className="text-text">{viewCount}</span></div>
                  <div className="mt-1">
                    Duration: <span className="text-text">
                      {rec.durationSeconds
                        ? `${Math.round(parseFloat(String(rec.durationSeconds)))}s`
                        : "—"}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-border bg-bg-subtle p-10 text-center text-sm text-text-subtle">
                Preview available once processing finishes.
              </div>
            )
          }
          settings={
            <SettingsSection
              recordingId={rec.id}
              hasPassword={!!rec.passwordHash}
              brandProfileId={rec.brand?.id ?? null}
              brandOptions={brandOptions.map((b) => ({ id: b.id, name: b.name }))}
            />
          }
          trim={
            <section>
              <h2 className="mb-3 text-sm font-semibold text-text">Trim</h2>
              <TrimEditor
                recordingId={rec.id}
                durationSec={
                  rec.durationSeconds != null
                    ? parseFloat(String(rec.durationSeconds))
                    : null
                }
                initialStart={trimStartSec}
                initialEnd={trimEndSec}
              />
            </section>
          }
          downloads={
            downloads.length > 0 ? (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-text">Downloads</h2>
                <DownloadsList links={downloads} />
              </section>
            ) : null
          }
          analytics={
            isReady ? (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-text">Analytics</h2>
                <DropoffChart buckets={dropoffBuckets} />
              </section>
            ) : null
          }
          danger={<DangerZone recordingId={rec.id} title={displayTitle} />}
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Manual verification**

`npm run dev` → visit `/recordings/<id>/edit`:
- Sticky preview on the left, sections on the right (≥1024px viewport).
- Title rename via pencil icon: change → blur → page refreshes with new title.
- Brand picker: change brand → page refreshes; revisit `/v/:slug` to confirm accent updated.
- Password set → check `/v/:slug` shows password gate.
- Trim works as before (lifted from OwnerToolbar).
- Drop-off chart: smooth filled-area curve, hover shows percentile + viewer count.
- Danger zone: type the wrong title → button disabled. Type the right title → "Permanently delete" enables → click → redirects to `/`. Verify card no longer shows on dashboard.

- [ ] **Step 4: Commit**

```bash
git add src/app/recordings/[id]/edit/page.tsx
git commit -m "feat(edit): wire EditShell sections (header / preview / settings / trim / downloads / analytics / danger)"
```

---

### Task 3.12: Phase 3 smoke + push

- [ ] **Step 1: Tests + typecheck + lint**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 2: Run the full pipeline smoke**

Run: `npm run smoke`
Expected: passes. (Smoke does not yet exercise `/recordings/[id]/edit`; if you want, append a fetch to the smoke to ensure 200.)

- [ ] **Step 3: Manual end-to-end run-through**

1. Sign in, dashboard.
2. ⋯ on a card → Edit → land on edit page.
3. Rename the title; refresh; confirm persisted.
4. Change the brand; refresh; visit `/v/:slug` and confirm accent matches.
5. Add password; visit `/v/:slug` in incognito → confirm password gate.
6. Trim 5 seconds off the start; visit `/v/:slug`; confirm playback starts at the new offset.
7. Download composite; confirm file downloads with the right name.
8. View drop-off chart; hover; confirm tooltip percentages + viewer counts make sense.
9. Delete a test recording (type the title); confirm redirect to dashboard and card is gone.

- [ ] **Step 4: Update ROADMAP.md**

Mark Stage 1.6 polish follow-ups as shipped.

```bash
# Read ROADMAP.md, update the Stage 1.5 polish section, mark items closed,
# add a Stage 1.6 row in the status table.
```

Concretely, in `ROADMAP.md`:
- Add a row to the status table (or a new "Stage 1.6" subheading) with status ✅ shipped and a description like:
  > Visitor / creator surface split — `/v/:slug` is now watch-first with chapter segments on the seekbar, summary + action items + chapters list above tabs (Transcript · Comments). All creator controls moved to `/recordings/[id]/edit` (sticky-preview two-column with inline title rename, brand picker, password, trim, downloads, redesigned drop-off chart, type-to-confirm delete).
- Strike through or mark as ✅ the four polish bullets in `### Stage 1.5 polish follow-ups` that this milestone closed.

- [ ] **Step 5: Commit + push**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): mark Stage 1.6 share-page redesign + creator console shipped"
git push
```

---

## Spec coverage check

Mapping each spec section to a task:

| Spec section | Task(s) |
|---|---|
| Goal — declutter share + extract creator console | Phase 1 + Phase 2 (whole) |
| `/v/:slug` watch-first, theater + tabs | 2.4–2.7 |
| Loom-style chapter segments overlay | 2.1–2.3 |
| Refactor ViewerShell to new structure | 2.6 |
| `/recordings/[id]/edit` new route | 1.2 |
| Sticky-preview two-column layout | 3.10 |
| Move OwnerToolbar / DropoffChart / view count / share URL off /v/:slug | 1.4 |
| Owner Edit pill on share page header | 1.5 |
| Dashboard card menu Edit link | 1.5 |
| Redesigned drop-off chart (filled area) | 3.4–3.5 |
| Inline title rename | 3.1–3.3, 3.6 |
| Brand reassignment | 3.1–3.3, 3.7 |
| Delete with confirmation | 3.8 |
| Empty states (no chapters, no actions, etc.) | Built into 2.2, 2.4 |
| `?tab=` URL state | 2.5 |
| Tests | 1.3, 2.1, 2.7, 3.4 |
| ROADMAP update | 3.12 |

No gaps detected.

## Notes for the executor

- **Do not skip the manual verification steps** in Tasks 1.6, 2.8, 3.12. Each phase has UI behavior that typecheck + unit tests can't cover.
- **If the chapter segments overlay misaligns with Plyr's progress bar,** revert Task 2.3's removal of the `markers` Plyr config and document the issue in the spec's risks section. The native point-markers are a working fallback.
- **Phase 1 is independently shippable.** You can `git push` after Task 1.6 and the share page is decluttered + edit page is functional, even before the visual redesign in Phase 2.
- **All three phases preserve `npm run smoke`** (the full Stage-1 pipeline test). It must pass before any push.
