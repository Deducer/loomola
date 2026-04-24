# M10 Trim Editing + Raw Track Downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-only trim editing (playback-only clamp) and individual signed download links for each raw track on `/v/:slug`.

**Architecture:** One pure `validateTrim` utility (shared between the client editor and the server route), a small R2 helper tweak for attachment downloads, a `PUT`/`DELETE` trim route, two new client components (`TrimEditor`, `DownloadsList`) mounted inside `OwnerToolbar`, and a `VideoPlayer` clamp based on two new nullable props. No DB migration — the trim columns already exist from M2.

**Tech Stack:** Next.js 15 App Router, React 19, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, Plyr, Tailwind, Vitest.

**Reference:** [M10 design spec](../specs/2026-04-24-loom-clone-m10-trim-downloads-design.md)

---

## File Structure

**New:**
- `src/lib/viewer/trim-validate.ts` — pure `validateTrim({ startSec, endSec, durationSec })`
- `src/app/api/recordings/[id]/trim/route.ts` — `PUT` / `DELETE`
- `src/components/viewer/trim-editor.tsx` — range-slider editor with Save / Reset / Cancel
- `src/components/viewer/downloads-list.tsx` — static signed-URL anchor list
- `tests/unit/trim-validate.test.ts`

**Modified:**
- `src/lib/r2/presigned-get.ts` — optional `opts.filename` adds `Content-Disposition`
- `src/db/queries/recordings.ts` — `updateTrim` + `clearTrim` helpers
- `src/components/viewer/owner-toolbar.tsx` — render `<TrimEditor>` + `<DownloadsList>`
- `src/components/viewer/video-player.tsx` — new `trimStartSec` / `trimEndSec` props + clamp logic
- `src/components/viewer/viewer-shell.tsx` — forward trim props to the player
- `src/app/v/[slug]/page.tsx` — presign downloads + pass trim + downloads down

---

## Task 1: validateTrim utility (TDD)

**Files:**
- Create: `src/lib/viewer/trim-validate.ts`
- Create: `tests/unit/trim-validate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/trim-validate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateTrim } from "@/lib/viewer/trim-validate";

describe("validateTrim", () => {
  it("accepts a simple valid trim", () => {
    expect(
      validateTrim({ startSec: 0, endSec: 10, durationSec: 15 })
    ).toEqual({ ok: true });
  });

  it("accepts the full boundary (start=0, end=duration)", () => {
    expect(
      validateTrim({ startSec: 0, endSec: 15, durationSec: 15 })
    ).toEqual({ ok: true });
  });

  it("accepts endSec slightly over duration within 0.5s tolerance", () => {
    expect(
      validateTrim({ startSec: 0, endSec: 15.3, durationSec: 15 })
    ).toEqual({ ok: true });
  });

  it("rejects a negative start", () => {
    expect(validateTrim({ startSec: -0.1, endSec: 5, durationSec: 15 })).toEqual({
      ok: false,
      error: "start_negative",
    });
  });

  it("rejects an end beyond duration + tolerance", () => {
    expect(validateTrim({ startSec: 0, endSec: 16, durationSec: 15 })).toEqual({
      ok: false,
      error: "end_out_of_bounds",
    });
  });

  it("rejects equal start and end", () => {
    expect(validateTrim({ startSec: 5, endSec: 5, durationSec: 15 })).toEqual({
      ok: false,
      error: "start_ge_end",
    });
  });

  it("rejects start greater than end", () => {
    expect(validateTrim({ startSec: 8, endSec: 3, durationSec: 15 })).toEqual({
      ok: false,
      error: "start_ge_end",
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
npx vitest run tests/unit/trim-validate.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/viewer/trim-validate'".

- [ ] **Step 3: Implement**

Create `src/lib/viewer/trim-validate.ts`:
```ts
export type TrimError = "start_negative" | "end_out_of_bounds" | "start_ge_end";

export type TrimValidationResult =
  | { ok: true }
  | { ok: false; error: TrimError };

const END_TOLERANCE_SEC = 0.5;

/**
 * Validates a trim range against a recording duration. Start must be >= 0,
 * end must be <= duration + 0.5s (tolerance for timestamp imprecision),
 * and start must be strictly less than end.
 */
export function validateTrim(params: {
  startSec: number;
  endSec: number;
  durationSec: number;
}): TrimValidationResult {
  if (params.startSec < 0) return { ok: false, error: "start_negative" };
  if (params.endSec > params.durationSec + END_TOLERANCE_SEC) {
    return { ok: false, error: "end_out_of_bounds" };
  }
  if (params.startSec >= params.endSec) {
    return { ok: false, error: "start_ge_end" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
npx vitest run tests/unit/trim-validate.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewer/trim-validate.ts tests/unit/trim-validate.test.ts
git commit -m "feat(m10): shared validateTrim utility with bounds + tolerance"
```

---

## Task 2: presignGet filename option

**Files:**
- Modify: `src/lib/r2/presigned-get.ts`

- [ ] **Step 1: Add optional opts + ResponseContentDisposition**

Replace the contents of `src/lib/r2/presigned-get.ts` with:
```ts
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, r2BucketName } from "./client";

/**
 * Returns a signed GET URL valid for 1 hour. When `opts.filename` is
 * supplied, the signed URL includes a `Content-Disposition: attachment`
 * directive with the given filename — clicking it triggers a browser
 * download instead of inline playback.
 */
export async function presignGet(
  key: string,
  opts: { filename?: string } = {}
): Promise<string> {
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: r2BucketName(),
    Key: key,
    ResponseContentDisposition: opts.filename
      ? `attachment; filename="${opts.filename.replace(/"/g, "")}"`
      : undefined,
  });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors. Existing call-sites (`presignGet(key)` with no second arg) are compatible with the new optional parameter.

- [ ] **Step 3: Commit**

```bash
git add src/lib/r2/presigned-get.ts
git commit -m "feat(r2): optional filename on presignGet adds Content-Disposition"
```

---

## Task 3: Trim DB helpers

**Files:**
- Modify: `src/db/queries/recordings.ts`

- [ ] **Step 1: Add updateTrim + clearTrim**

Append to the end of `src/db/queries/recordings.ts` (after `softDeleteRecording`):
```ts
export async function updateTrim(params: {
  id: string;
  ownerId: string;
  startSec: number;
  endSec: number;
}): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({
      trimStartSec: String(params.startSec),
      trimEndSec: String(params.endSec),
    })
    .where(
      and(eq(mediaObjects.id, params.id), eq(mediaObjects.ownerId, params.ownerId))
    )
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}

export async function clearTrim(params: {
  id: string;
  ownerId: string;
}): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({ trimStartSec: null, trimEndSec: null })
    .where(
      and(eq(mediaObjects.id, params.id), eq(mediaObjects.ownerId, params.ownerId))
    )
    .returning({ id: mediaObjects.id });
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
git add src/db/queries/recordings.ts
git commit -m "feat(m10): updateTrim + clearTrim owner-scoped query helpers"
```

---

## Task 4: Trim API route

**Files:**
- Create: `src/app/api/recordings/[id]/trim/route.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/recordings/[id]/trim/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { validateTrim } from "@/lib/viewer/trim-validate";
import { updateTrim, clearTrim } from "@/db/queries/recordings";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    startSec?: number;
    endSec?: number;
  };
  const startSec = typeof body.startSec === "number" ? body.startSec : NaN;
  const endSec = typeof body.endSec === "number" ? body.endSec : NaN;
  if (!isFinite(startSec) || !isFinite(endSec)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const [rec] = await db
    .select({
      id: mediaObjects.id,
      ownerId: mediaObjects.ownerId,
      durationSeconds: mediaObjects.durationSeconds,
    })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, user.id)))
    .limit(1);

  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const durationSec = parseFloat(String(rec.durationSeconds ?? "0"));
  const check = validateTrim({ startSec, endSec, durationSec });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const ok = await updateTrim({ id, ownerId: user.id, startSec, endSec });
  if (!ok) {
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
  const ok = await clearTrim({ id, ownerId: user.id });
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
git add 'src/app/api/recordings/[id]/trim/route.ts'
git commit -m "feat(m10): PUT/DELETE /api/recordings/:id/trim with shared validator"
```

---

## Task 5: TrimEditor client component

**Files:**
- Create: `src/components/viewer/trim-editor.tsx`

- [ ] **Step 1: Implement**

Create `src/components/viewer/trim-editor.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { validateTrim, type TrimError } from "@/lib/viewer/trim-validate";

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

const ERROR_LABELS: Record<TrimError, string> = {
  start_negative: "Start must be >= 0.",
  end_out_of_bounds: "End can't be past the recording duration.",
  start_ge_end: "Start must be less than end.",
};

export function TrimEditor({
  recordingId,
  durationSec,
  initialStart,
  initialEnd,
}: {
  recordingId: string;
  durationSec: number | null;
  initialStart: number | null;
  initialEnd: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(initialStart ?? 0);
  const [end, setEnd] = useState(initialEnd ?? durationSec ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (durationSec == null || durationSec <= 0) {
    return (
      <div className="mt-4 rounded-lg border border-white/10 p-3 text-sm opacity-60">
        Trim: duration not available yet — try again after the recording
        finishes processing.
      </div>
    );
  }

  const hasTrim = initialStart != null && initialEnd != null;
  const check = validateTrim({ startSec: start, endSec: end, durationSec });

  async function save() {
    if (!check.ok) {
      setError(ERROR_LABELS[check.error]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/trim`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startSec: start, endSec: end }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error && data.error in ERROR_LABELS
            ? ERROR_LABELS[data.error as TrimError]
            : `Save failed (${res.status}).`
        );
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/trim`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`Reset failed (${res.status}).`);
        return;
      }
      setOpen(false);
      setStart(0);
      setEnd(durationSec);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-white/10 p-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="opacity-60">Trim:</span>
        <span className={hasTrim ? "text-emerald-300" : "opacity-70"}>
          {hasTrim
            ? `${formatTs(initialStart!)}–${formatTs(initialEnd!)}`
            : "off"}
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
            setError(null);
          }}
          className="ml-auto rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
        >
          {hasTrim ? "Edit" : "Set trim"}
        </button>
        {hasTrim && (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-200 hover:bg-red-500/30 disabled:opacity-50"
          >
            Reset
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <div className="flex items-center justify-between text-xs opacity-70">
            <span>Start: {formatTs(start)}</span>
            <span>End: {formatTs(end)}</span>
          </div>
          <label className="block text-xs opacity-60">Start</label>
          <input
            type="range"
            min={0}
            max={durationSec}
            step={0.5}
            value={start}
            onChange={(e) => setStart(parseFloat(e.target.value))}
            className="w-full"
          />
          <label className="block text-xs opacity-60">End</label>
          <input
            type="range"
            min={0}
            max={durationSec}
            step={0.5}
            value={end}
            onChange={(e) => setEnd(parseFloat(e.target.value))}
            className="w-full"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
                setStart(initialStart ?? 0);
                setEnd(initialEnd ?? durationSec);
              }}
              className="rounded px-2 py-1 text-xs opacity-70 hover:opacity-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !check.ok}
              className="rounded bg-white/20 px-3 py-1 text-xs hover:bg-white/30 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/viewer/trim-editor.tsx
git commit -m "feat(m10): TrimEditor with two range handles + shared validator"
```

---

## Task 6: DownloadsList client component

**Files:**
- Create: `src/components/viewer/downloads-list.tsx`

- [ ] **Step 1: Implement**

Create `src/components/viewer/downloads-list.tsx`:
```tsx
"use client";

export type DownloadLink = {
  kind: string; // e.g. "Composite", "Screen", "Camera", "Mic", "System audio"
  href: string;
};

export function DownloadsList({ links }: { links: DownloadLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-white/10 p-3 text-sm">
      <span className="opacity-60">Downloads:</span>
      <ul className="mt-2 space-y-1">
        {links.map((l) => (
          <li key={l.kind}>
            <a
              href={l.href}
              download
              className="inline-block rounded bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
            >
              {l.kind}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/viewer/downloads-list.tsx
git commit -m "feat(m10): DownloadsList renders signed download anchors"
```

---

## Task 7: OwnerToolbar wiring

**Files:**
- Modify: `src/components/viewer/owner-toolbar.tsx`

- [ ] **Step 1: Extend OwnerToolbar with trim + downloads**

Open `src/components/viewer/owner-toolbar.tsx`. Update the imports at the top:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrimEditor } from "./trim-editor";
import { DownloadsList, type DownloadLink } from "./downloads-list";
```

Update the component signature + destructure:
```tsx
export function OwnerToolbar({
  recordingId,
  hasPassword,
  durationSec,
  trimStartSec,
  trimEndSec,
  downloads,
}: {
  recordingId: string;
  hasPassword: boolean;
  durationSec: number | null;
  trimStartSec: number | null;
  trimEndSec: number | null;
  downloads: DownloadLink[];
}) {
```

At the end of the rendered JSX, after the existing password row's closing `</div>`, add two siblings. Find the LAST `</div>` of the `<div className="mt-4 flex flex-wrap items-center gap-3 ...">` block and wrap the whole thing in a fragment so we can append `<TrimEditor>` and `<DownloadsList>`. Specifically:

Before (the tail of the component):
```tsx
      {open && (
        <div className="flex w-full items-center gap-2 border-t border-white/10 pt-3">
          ...
        </div>
      )}
    </div>
  );
}
```

After:
```tsx
      {open && (
        <div className="flex w-full items-center gap-2 border-t border-white/10 pt-3">
          ...
        </div>
      )}
    </div>
    <TrimEditor
      recordingId={recordingId}
      durationSec={durationSec}
      initialStart={trimStartSec}
      initialEnd={trimEndSec}
    />
    <DownloadsList links={downloads} />
    </>
  );
}
```

And change the opening `return (` to `return ( <> ` and keep the existing top-level `<div>` as the first fragment child. Full shape:

```tsx
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-3 text-sm">
        {/* existing password row content */}
      </div>
      <TrimEditor
        recordingId={recordingId}
        durationSec={durationSec}
        initialStart={trimStartSec}
        initialEnd={trimEndSec}
      />
      <DownloadsList links={downloads} />
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -15
```

Expected: errors about the page-level call-site missing the new props (those are fixed in Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/components/viewer/owner-toolbar.tsx
git commit -m "feat(m10): OwnerToolbar renders TrimEditor + DownloadsList sections"
```

---

## Task 8: VideoPlayer trim clamp

**Files:**
- Modify: `src/components/viewer/video-player.tsx`

- [ ] **Step 1: Extend Props with trim fields**

In `src/components/viewer/video-player.tsx`, update the `Props` type:
```ts
type Props = {
  slug: string;
  initialSignedUrl: string;
  chapters: Chapter[];
  accentColor: string;
  onTimeUpdate: (sec: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onReady?: () => void;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
};
```

Update the destructure in the forwardRef signature:
```tsx
export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  {
    slug,
    initialSignedUrl,
    chapters,
    accentColor,
    onTimeUpdate,
    onPlayStateChange,
    onReady,
    trimStartSec,
    trimEndSec,
  },
  ref
) {
```

- [ ] **Step 2: Wire trim clamping into Plyr event handlers**

In the same file, find the Plyr setup effect body — the block after `plyrRef.current = new Plyr(videoRef.current, { markers: ... });`.

Replace the `plyrRef.current.on("timeupdate", ...)` block with a trim-aware version. The full block of event hookups should read:
```ts
      plyrRef.current.on("timeupdate", () => {
        const t = plyrRef.current?.currentTime ?? 0;
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
      plyrRef.current.on("play", () => onPlayStateChange?.(true));
      plyrRef.current.on("pause", () => onPlayStateChange?.(false));
      plyrRef.current.on("ended", () => onPlayStateChange?.(false));
      plyrRef.current.on("ready", () => onReady?.());
      plyrRef.current.on("loadedmetadata", () => {
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

- [ ] **Step 3: Add trim props to effect deps**

Find the closing `}, [chapters, onTimeUpdate, onPlayStateChange, onReady]);` and update to:
```ts
  }, [chapters, onTimeUpdate, onPlayStateChange, onReady, trimStartSec, trimEndSec]);
```

- [ ] **Step 4: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors inside `video-player.tsx`. There may still be errors at the shell/page call-sites (fixed next).

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/video-player.tsx
git commit -m "feat(m10): VideoPlayer clamps playback to trim_start_sec / trim_end_sec"
```

---

## Task 9: Shell + page wiring

**Files:**
- Modify: `src/components/viewer/viewer-shell.tsx`
- Modify: `src/app/v/[slug]/page.tsx`

- [ ] **Step 1: Forward trim props through ViewerShell**

In `src/components/viewer/viewer-shell.tsx`, update the `ViewerShellProps` type:
```ts
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
  trimStartSec: number | null;
  trimEndSec: number | null;
};
```

Update the function destructure to include the two new props, and pass them into `<VideoPlayer>`:
```tsx
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
  trimStartSec,
  trimEndSec,
}: ViewerShellProps) {
```

And in the `<VideoPlayer>` element:
```tsx
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
```

- [ ] **Step 2: Presign downloads in the page + pass everything through**

In `src/app/v/[slug]/page.tsx`, after the existing `commentRows` mapping, add a downloads block. Find the block that looks like:
```ts
  const rawComments = await listCommentsForRecording(rec.id);
  const commentRows = rawComments.map((c) => ({
    ...
  }));
```

Immediately after it, append:
```ts
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
  const downloads = isOwner
    ? await Promise.all(
        downloadKinds
          .filter((d) => !!d.key)
          .map(async (d) => ({
            kind: d.kind,
            href: await presignGet(d.key!, {
              filename: `${slug}-${d.fileKind}.webm`,
            }),
          }))
      )
    : [];
```

Find the `<OwnerToolbar ... />` call and update it to pass the new props:
```tsx
        {isOwner && (
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
        )}
```

Find the `<ViewerShell ... />` call and add the two trim props:
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
              trimStartSec={trimStartSec}
              trimEndSec={trimEndSec}
            />
```

- [ ] **Step 3: Build**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -25
```

Expected: "Compiled successfully" and no type errors. The new route `/api/recordings/[id]/trim` should appear in the output.

- [ ] **Step 4: Commit**

```bash
git add src/components/viewer/viewer-shell.tsx 'src/app/v/[slug]/page.tsx'
git commit -m "feat(m10): page + shell pass trim props and presigned downloads"
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

Wait for Coolify deploy:
```bash
until ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Status}}" | grep -q "Up [0-9]\+ seconds"'; do sleep 15; done
ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Names}} {{.Status}}"'
```

- [ ] **Step 2: Smoke — trim set via API**

Against a known-ready slug (e.g., `0Drw5PTR5m`), first get its id:
```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
(async () => {
  const r = await sql`SELECT id, duration_seconds FROM media_objects WHERE slug = '"'"'0Drw5PTR5m'"'"'`;
  console.log(JSON.stringify(r, null, 2));
  await sql.end();
})();
'
```

Expected: a row with id + duration. Note the id.

Run a test PUT directly against the DB (because the PUT endpoint requires auth; easier to exercise ownership via the owner browser in Step 3, but we can verify the shape locally):
```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
(async () => {
  await sql`UPDATE media_objects SET trim_start_sec = 3, trim_end_sec = 10 WHERE slug = '"'"'0Drw5PTR5m'"'"'`;
  console.log("trim set");
  await sql.end();
})();
'
```

- [ ] **Step 3: Smoke — viewer clamp + download links**

Open `https://loom.dissonance.cloud/v/0Drw5PTR5m` in a signed-in owner browser:
- Verify the toolbar shows "Trim: 0:03–0:10" + a "Downloads" card listing `Composite` (plus any raw tracks present).
- Play the video. Expected: auto-seeks to 0:03 on load; pauses when reaching 0:10.
- Scrub past 0:10 via the Plyr bar. Expected: playback snaps back to just before 0:10.
- Click the `Composite` download link. Expected: browser downloads `0Drw5PTR5m-composite.webm`.
- Open the same URL in an incognito window (non-owner). Expected: no toolbar visible, but playback still clamps to 0:03–0:10.

- [ ] **Step 4: Smoke — trim UI save + reset**

Still in the owner browser:
- Click "Edit" next to the trim row → panel expands showing two range sliders at 3 / 10.
- Drag start to 0:01, end to 0:12. Click Save. Page refreshes. Toolbar shows "Trim: 0:01–0:12".
- Click "Reset". Page refreshes. Toolbar shows "Trim: off". Playback plays the full 15s again.

- [ ] **Step 5: Clean up test trim via DB (if needed)**

Only if you left the trim set via the API smoke test:
```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
(async () => {
  await sql`UPDATE media_objects SET trim_start_sec = NULL, trim_end_sec = NULL WHERE slug = '"'"'0Drw5PTR5m'"'"'`;
  console.log("trim cleared");
  await sql.end();
})();
'
```

- [ ] **Step 6: Update ROADMAP.md**

Change the M10 row in `ROADMAP.md`:
```
| M10 | Trim editing (E2) + raw downloads | 🔄 next | Trim UI, player clamping to trimmed range, ZIP endpoint for raw track download |
| M11 | Polish + full-pipeline smoke E2E | ⏳ planned | Production readiness, end-to-end golden path test across the whole pipeline |
```
to:
```
| M10 | Trim editing + raw downloads | ✅ shipped | Owner-only trim editor on /v/:slug (two-range-slider UI), player-side clamp to [trim_start_sec, trim_end_sec] via JS (no re-encoding); per-track signed download links with Content-Disposition filenames |
| M11 | Polish + full-pipeline smoke E2E | 🔄 next | Production readiness, end-to-end golden path test across the whole pipeline |
```

- [ ] **Step 7: Update CLAUDE.md**

Add this line to `CLAUDE.md` beneath the existing M9 entry:
```
- [x] **M10: Trim editing + raw downloads** — owner-only trim editor with Save/Reset, PUT/DELETE /api/recordings/:id/trim, viewer-side playback clamp to [trim_start_sec, trim_end_sec], per-raw-track signed download links with Content-Disposition filenames.
```

- [ ] **Step 8: Commit + push**

```bash
git add ROADMAP.md CLAUDE.md
git commit -m "chore(m10): mark trim + downloads milestone shipped"
git push origin main
```

---

## Self-Review Notes

- Spec coverage:
  - Trim API + validator → Tasks 1, 3, 4.
  - TrimEditor UI → Task 5; uses the same `validateTrim` as the server.
  - Player clamp (loadedmetadata + timeupdate) → Task 8.
  - Signed download URLs with `Content-Disposition` → Task 2 (helper) + Task 9 (call-site).
  - DownloadsList renders anchors → Task 6.
  - OwnerToolbar mounts both new UIs → Task 7.
  - No migration → confirmed; columns exist from M2.

- Types are consistent:
  - `validateTrim({ startSec, endSec, durationSec }) → { ok: true } | { ok: false, error: TrimError }` — used in Tasks 1, 4, 5.
  - `TrimError = "start_negative" | "end_out_of_bounds" | "start_ge_end"` — Task 1, referenced Task 5.
  - `presignGet(key, { filename? })` — Task 2 definition; Task 9 call-site.
  - `DownloadLink = { kind: string; href: string }` — Task 6 definition; Task 7 import; Task 9 producer.
  - `OwnerToolbar` gains `durationSec`, `trimStartSec`, `trimEndSec`, `downloads` — Task 7 definition; Task 9 call-site.
  - `ViewerShellProps` gains `trimStartSec`, `trimEndSec` — Task 9 definition + call-site.

- Risk mitigations from the spec:
  - Dual-handle range styling → Task 5 uses two stacked ranges; if Safari breaks, we swap to a lib.
  - Trim clamp race (~250ms) → documented as acceptable in the spec; Task 8 matches.
  - Content-Disposition on R2 → verified manually in Task 10 Step 3.
  - Signed URL expiry > 1h → documented; reload regenerates.
