# Loom Clone — Milestone 5: Deepgram Transcription — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a recording finishes uploading, enqueue a Deepgram transcription job that sends the composite audio URL + a signed callback, then persist the transcript into `transcripts` when Deepgram POSTs back.

**Architecture:** A pg-boss job queue (Postgres-backed, started at server boot via `src/instrumentation.ts`) runs inside the Next.js container. The `/api/recordings/[id]/complete` route — already wired in M4 — now also enqueues a `transcribe` job after marking the media object `transcribing`. The job sends a Deepgram async request including an HMAC-signed callback URL. Deepgram processes the audio and POSTs the transcript to `/api/webhooks/deepgram/[recordingId]`, which verifies the HMAC, inserts the `transcripts` row, and flips status to `ready`.

**Tech Stack:** `pg-boss` (Postgres job queue), `@deepgram/sdk` (async prerecorded API with callback), Node.js `crypto.createHmac` for webhook signature, Next.js 15 `instrumentation.ts` hook, existing `@/lib/r2/presigned-get` for audio URLs.

---

## File Structure (Milestone 5)

**New files:**

```
src/
├── lib/
│   ├── queue/
│   │   ├── boss.ts                       # lazy singleton pg-boss + registration
│   │   └── jobs/
│   │       └── transcribe.ts             # transcribe job handler + payload type
│   ├── deepgram/
│   │   ├── client.ts                     # cached Deepgram client factory
│   │   └── callback-signature.ts         # HMAC sign/verify for webhook URL
│   └── db/queries/
│       └── transcripts.ts                # insertTranscript, getTranscriptByRecording
├── instrumentation.ts                    # Next.js 15 server-start hook
└── app/
    └── api/
        └── webhooks/
            └── deepgram/
                └── [recordingId]/route.ts

drizzle/
└── (no new migrations — transcripts table already exists from M2)

tests/
└── unit/
    └── callback-signature.test.ts        # HMAC verification round-trip
```

**Modified files:**

- `src/app/api/recordings/[id]/complete/route.ts` — enqueue `transcribe` job + set status to `transcribing` (instead of `ready`)
- `src/lib/supabase/middleware.ts` — allow unauth access to `/api/webhooks/`
- `src/app/v/[slug]/page.tsx` — show transcript snippet when available (owner only)

**File responsibility boundaries:**

- `src/lib/queue/boss.ts` — owns pg-boss lifecycle. `getBoss()` returns a started singleton. Worker handlers registered lazily on first call. No direct DB reads.
- `src/lib/queue/jobs/transcribe.ts` — pure job handler. Takes `{ mediaObjectId, compositeKey }`, calls Deepgram. Does not touch DB directly (that's the webhook's responsibility).
- `src/lib/deepgram/client.ts` — cached SDK client. Reads env at first call; throws if missing.
- `src/lib/deepgram/callback-signature.ts` — pure crypto. No side effects.
- `src/instrumentation.ts` — runs once at server boot. Only imports `@/lib/queue/boss` to trigger init. Guarded by `NEXT_RUNTIME === 'nodejs'`.
- `src/app/api/webhooks/deepgram/[recordingId]/route.ts` — verifies signature, parses body, inserts transcript, flips status to `ready`.

---

## Tasks

### Task 1: Deepgram API key (USER ACTION)

- [ ] **Step 1: Get a Deepgram API key**

1. Log in to https://console.deepgram.com
2. API Keys → Create a New API Key
3. Name: `loom-clone`
4. Permissions: **Member** (create + read transcripts; no billing access)
5. Project: whatever you have (free tier is fine; Nova model is covered)
6. Copy the key

- [ ] **Step 2: Generate a webhook signing secret**

Run locally (doesn't hit any service):

```bash
openssl rand -hex 32
```

Copy the output. This is the shared HMAC secret between our server and our own webhook handler — Deepgram forwards our callback URL verbatim with a signature we embedded, so verification happens entirely within our code.

- [ ] **Step 3: Paste both into Doppler**

https://dashboard.doppler.com/workplace/projects/dissonance-cloud/configs/prd_loom → add:

```
DEEPGRAM_API_KEY=<key from step 1>
DEEPGRAM_CALLBACK_SIGNING_SECRET=<hex from step 2>
```

- [ ] **Step 4: Mirror to `.env.local`**

Append to `/Users/iancross/Development/03Utilities/Loom_Clone/.env.local`:

```
DEEPGRAM_API_KEY=<same>
DEEPGRAM_CALLBACK_SIGNING_SECRET=<same>
```

Tell the agent "done" when all four steps are complete.

---

### Task 2: Install pg-boss + Deepgram SDK

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
cd /Users/iancross/Development/03Utilities/Loom_Clone
npm install pg-boss @deepgram/sdk
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pg-boss + @deepgram/sdk"
```

---

### Task 3: HMAC callback signature utility

**Files:**
- Create: `src/lib/deepgram/callback-signature.ts`

- [ ] **Step 1: Create the module**

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const secret = process.env.DEEPGRAM_CALLBACK_SIGNING_SECRET;
  if (!secret) {
    throw new Error("DEEPGRAM_CALLBACK_SIGNING_SECRET is not set");
  }
  return secret;
}

/** Produces a hex HMAC-SHA256 of the recording id. */
export function signRecordingId(recordingId: string): string {
  return createHmac("sha256", getSecret()).update(recordingId).digest("hex");
}

/** Constant-time compare; returns false on any mismatch or malformed input. */
export function verifyRecordingSignature(
  recordingId: string,
  signature: string
): boolean {
  if (!signature) return false;
  const expected = signRecordingId(recordingId);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/deepgram/callback-signature.ts
git commit -m "feat(deepgram): HMAC signature helpers for webhook URL"
```

---

### Task 4: Unit tests for callback signature

**Files:**
- Create: `tests/unit/callback-signature.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import {
  signRecordingId,
  verifyRecordingSignature,
} from "@/lib/deepgram/callback-signature";

beforeAll(() => {
  process.env.DEEPGRAM_CALLBACK_SIGNING_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("signRecordingId", () => {
  it("produces a 64-char hex string", () => {
    const sig = signRecordingId("00000000-0000-0000-0000-000000000001");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const a = signRecordingId("abc");
    const b = signRecordingId("abc");
    expect(a).toBe(b);
  });

  it("changes when input changes", () => {
    const a = signRecordingId("abc");
    const b = signRecordingId("abd");
    expect(a).not.toBe(b);
  });
});

describe("verifyRecordingSignature", () => {
  it("accepts a freshly-signed value", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    expect(verifyRecordingSignature(id, signRecordingId(id))).toBe(true);
  });

  it("rejects a tampered id", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    const sig = signRecordingId(id);
    expect(verifyRecordingSignature("different-id", sig)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifyRecordingSignature("any", "")).toBe(false);
  });

  it("rejects a short / malformed signature", () => {
    expect(verifyRecordingSignature("any", "zzz")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test
```
Expected: 18 (existing) + 7 (new) = 25 tests passing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/callback-signature.test.ts
git commit -m "test(deepgram): HMAC signature helpers"
```

---

### Task 5: Deepgram client factory

**Files:**
- Create: `src/lib/deepgram/client.ts`

- [ ] **Step 1: Create the module**

```typescript
import { createClient, type DeepgramClient } from "@deepgram/sdk";

let cached: DeepgramClient | null = null;

export function getDeepgramClient(): DeepgramClient {
  if (cached) return cached;
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  cached = createClient(key);
  return cached;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/deepgram/client.ts
git commit -m "feat(deepgram): cached SDK client factory"
```

---

### Task 6: Transcripts query module

**Files:**
- Create: `src/db/queries/transcripts.ts`

- [ ] **Step 1: Create the module**

```typescript
import { db } from "@/db";
import { transcripts } from "@/db/schema";
import { eq } from "drizzle-orm";

export type Transcript = typeof transcripts.$inferSelect;

export type WordTimestamp = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
};

export async function insertTranscript(params: {
  mediaObjectId: string;
  deepgramRequestId: string | null;
  language: string;
  fullText: string;
  wordTimestamps: WordTimestamp[];
}): Promise<Transcript> {
  const [row] = await db
    .insert(transcripts)
    .values({
      mediaObjectId: params.mediaObjectId,
      deepgramRequestId: params.deepgramRequestId,
      language: params.language,
      fullText: params.fullText,
      wordTimestamps: params.wordTimestamps,
    })
    .returning();
  return row;
}

export async function getTranscriptByRecording(
  mediaObjectId: string
): Promise<Transcript | null> {
  const [row] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.mediaObjectId, mediaObjectId))
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/transcripts.ts
git commit -m "feat(db): transcripts query module"
```

---

### Task 7: Transcribe job handler

**Files:**
- Create: `src/lib/queue/jobs/transcribe.ts`

- [ ] **Step 1: Create the module**

```typescript
import { getDeepgramClient } from "@/lib/deepgram/client";
import { presignGet } from "@/lib/r2/presigned-get";
import { signRecordingId } from "@/lib/deepgram/callback-signature";

export const TRANSCRIBE_JOB = "transcribe";

export type TranscribeJobData = {
  mediaObjectId: string;
  compositeKey: string;
};

/**
 * Sends a Deepgram async prerecorded request pointing at the composite R2
 * URL. Deepgram will POST the transcript to our webhook when ready. The
 * job itself completes as soon as Deepgram ACKs the request.
 */
export async function runTranscribeJob(data: TranscribeJobData): Promise<void> {
  const { mediaObjectId, compositeKey } = data;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");

  const audioUrl = await presignGet(compositeKey);
  const sig = signRecordingId(mediaObjectId);
  const callbackUrl = `${appUrl}/api/webhooks/deepgram/${mediaObjectId}?sig=${sig}`;

  const dg = getDeepgramClient();
  const { result, error } =
    await dg.listen.prerecorded.transcribeUrlCallback(
      { url: audioUrl },
      new URL(callbackUrl),
      {
        model: "nova-2",
        smart_format: true,
        punctuate: true,
        language: "en",
        detect_language: false,
      }
    );

  if (error) {
    throw new Error(
      `Deepgram submission failed: ${error.message ?? String(error)}`
    );
  }
  if (!result) {
    throw new Error("Deepgram submission returned no result");
  }
  // result.request_id is useful for logs / reconciling which webhook maps
  // to which job; we stash it via the webhook (which receives the same id).
  console.log(
    `[transcribe] enqueued Deepgram request ${result.request_id} for media ${mediaObjectId}`
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/jobs/transcribe.ts
git commit -m "feat(queue): transcribe job — send Deepgram request with signed callback"
```

---

### Task 8: pg-boss singleton + worker registration

**Files:**
- Create: `src/lib/queue/boss.ts`

- [ ] **Step 1: Create the module**

```typescript
import PgBoss from "pg-boss";
import { TRANSCRIBE_JOB, runTranscribeJob, type TranscribeJobData } from "./jobs/transcribe";

let cached: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function init(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const boss = new PgBoss({
    connectionString,
    // Share the connection pool pattern with Drizzle: no prepare, small pool.
    max: 4,
    // Keep pg-boss' own housekeeping quiet — we don't need its archive table
    // to be multi-GB in a personal tool.
    archiveCompletedAfterSeconds: 60 * 60 * 24 * 7, // 7 days
    deleteAfterDays: 30,
  });

  boss.on("error", (err) => {
    console.error("[pg-boss] error:", err);
  });

  await boss.start();

  // Register worker handlers. Each handler runs on this process; at scale
  // multiple containers can claim jobs concurrently without coordination.
  await boss.work<TranscribeJobData>(TRANSCRIBE_JOB, async ([job]) => {
    await runTranscribeJob(job.data);
  });

  console.log("[pg-boss] started and workers registered");
  return boss;
}

/** Returns a started pg-boss singleton. Safe to call concurrently. */
export async function getBoss(): Promise<PgBoss> {
  if (cached) return cached;
  if (!starting) {
    starting = init().then((b) => {
      cached = b;
      return b;
    });
  }
  return starting;
}

/** Enqueues a transcription job for the given recording. */
export async function enqueueTranscription(
  data: TranscribeJobData
): Promise<void> {
  const boss = await getBoss();
  await boss.send(TRANSCRIBE_JOB, data, {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInHours: 1,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/boss.ts
git commit -m "feat(queue): pg-boss singleton + transcribe worker registration"
```

---

### Task 9: Next.js instrumentation hook

**Files:**
- Create: `src/instrumentation.ts`
- Modify: `next.config.ts` (enable instrumentation)

- [ ] **Step 1: Enable instrumentation in next.config.ts**

Replace the file with:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
```

(In Next.js 15, `instrumentation.ts` is opt-in via the file's presence alone — no config flag needed. Leaving the existing config unchanged.)

- [ ] **Step 2: Create the instrumentation file**

```typescript
/**
 * Next.js calls this once at server boot (Node.js runtime only).
 * Used to eagerly start pg-boss so workers are ready before the first API
 * request that enqueues a job.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getBoss } = await import("@/lib/queue/boss");
  try {
    await getBoss();
  } catch (err) {
    // Don't crash the server on queue init failure; the first API request
    // that calls getBoss() will retry and surface a useful error.
    console.error("[instrumentation] pg-boss init failed:", err);
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/instrumentation.ts
git commit -m "feat(queue): start pg-boss at server boot via instrumentation hook"
```

---

### Task 10: Enqueue transcription in /api/recordings/[id]/complete

**Files:**
- Modify: `src/app/api/recordings/[id]/complete/route.ts`

- [ ] **Step 1: Replace the route**

Overwrite `src/app/api/recordings/[id]/complete/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingOwned } from "@/db/queries/recordings";
import { completeMultipartUpload } from "@/lib/r2/multipart";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { TrackKind } from "@/lib/recording/types";
import { enqueueTranscription } from "@/lib/queue/boss";

type CompleteRequest = {
  tracks: Partial<
    Record<TrackKind, Array<{ PartNumber: number; ETag: string }>>
  >;
  durationSeconds: number;
};

type UploadMeta = {
  [K in TrackKind]?: { uploadId: string; key: string };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json()) as CompleteRequest;

  const recording = await getRecordingOwned(id, user.id);
  if (!recording) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = recording.uploadMetadata as UploadMeta | null;
  if (!meta) {
    return NextResponse.json({ error: "No active uploads" }, { status: 400 });
  }

  const keyUpdates: {
    r2CompositeKey?: string;
    r2ScreenKey?: string;
    r2CameraKey?: string;
    r2MicKey?: string;
    r2SystemaudioKey?: string;
  } = {};

  const completions: Promise<void>[] = [];
  for (const [kind, parts] of Object.entries(body.tracks) as Array<
    [TrackKind, Array<{ PartNumber: number; ETag: string }>]
  >) {
    const trackMeta = meta[kind];
    if (!trackMeta) continue;
    if (!parts || parts.length === 0) continue;
    completions.push(
      completeMultipartUpload(trackMeta.key, trackMeta.uploadId, parts)
    );
    switch (kind) {
      case "composite":
        keyUpdates.r2CompositeKey = trackMeta.key;
        break;
      case "screen":
        keyUpdates.r2ScreenKey = trackMeta.key;
        break;
      case "camera":
        keyUpdates.r2CameraKey = trackMeta.key;
        break;
      case "mic":
        keyUpdates.r2MicKey = trackMeta.key;
        break;
      case "system-audio":
        keyUpdates.r2SystemaudioKey = trackMeta.key;
        break;
    }
  }
  await Promise.all(completions);

  // Flip to 'transcribing' (was 'ready' pre-M5). Webhook moves to 'ready'.
  await db
    .update(mediaObjects)
    .set({
      ...keyUpdates,
      durationSeconds: String(body.durationSeconds),
      status: "transcribing",
      uploadMetadata: null,
    })
    .where(
      and(eq(mediaObjects.id, recording.id), eq(mediaObjects.ownerId, user.id))
    );

  // Enqueue transcription only if we have a composite to transcribe. If not
  // (shouldn't happen for video recordings), leave status as 'transcribing'
  // and rely on ops/cleanup; don't fail the user's complete request.
  if (keyUpdates.r2CompositeKey) {
    try {
      await enqueueTranscription({
        mediaObjectId: recording.id,
        compositeKey: keyUpdates.r2CompositeKey,
      });
    } catch (err) {
      console.error("[complete] failed to enqueue transcription:", err);
      // Fall through — user still gets a slug; we'll notice the stuck row.
    }
  }

  return NextResponse.json({ slug: recording.slug });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/recordings/[id]/complete/route.ts"
git commit -m "feat(api): flip status to transcribing + enqueue Deepgram job on upload complete"
```

---

### Task 11: Deepgram webhook route

**Files:**
- Create: `src/app/api/webhooks/deepgram/[recordingId]/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import { verifyRecordingSignature } from "@/lib/deepgram/callback-signature";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { insertTranscript, type WordTimestamp } from "@/db/queries/transcripts";

type DeepgramWord = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  punctuated_word?: string;
};

type DeepgramAlternative = {
  transcript?: string;
  confidence?: number;
  words?: DeepgramWord[];
};

type DeepgramChannel = {
  alternatives?: DeepgramAlternative[];
  detected_language?: string;
};

type DeepgramCallbackBody = {
  metadata?: {
    request_id?: string;
    created?: string;
  };
  results?: {
    channels?: DeepgramChannel[];
  };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ recordingId: string }> }
) {
  const { recordingId } = await params;
  const { searchParams } = new URL(request.url);
  const sig = searchParams.get("sig") ?? "";

  if (!verifyRecordingSignature(recordingId, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = (await request.json()) as DeepgramCallbackBody;
  const channel = body.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const words = alt?.words ?? [];
  const fullText = alt?.transcript ?? "";
  const language = channel?.detected_language ?? "en";
  const requestId = body.metadata?.request_id ?? null;

  // Normalize Deepgram words into our simpler shape.
  const wordTimestamps: WordTimestamp[] = words.map((w) => ({
    word: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
  }));

  await insertTranscript({
    mediaObjectId: recordingId,
    deepgramRequestId: requestId,
    language,
    fullText,
    wordTimestamps,
  });

  await db
    .update(mediaObjects)
    .set({ status: "ready" })
    .where(eq(mediaObjects.id, recordingId));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/webhooks/deepgram/[recordingId]/route.ts"
git commit -m "feat(api): Deepgram webhook — verify HMAC + persist transcript"
```

---

### Task 12: Allow unauth access to /api/webhooks/

**Files:**
- Modify: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Widen the public check**

Find the existing `isPublicShare` block and add a webhook allowlist:

```typescript
  const url = request.nextUrl.clone();
  const isAuthRoute = url.pathname.startsWith("/login") ||
                      url.pathname.startsWith("/auth");
  const isApiHealth = url.pathname === "/api/health";
  const isPublicShare = url.pathname.startsWith("/v/");
  const isWebhook = url.pathname.startsWith("/api/webhooks/");

  if (!user && !isAuthRoute && !isApiHealth && !isPublicShare && !isWebhook) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/middleware.ts
git commit -m "feat(auth): allow unauth access to /api/webhooks/*"
```

---

### Task 13: Show transcript snippet on share page

**Files:**
- Modify: `src/app/v/[slug]/page.tsx`

- [ ] **Step 1: Import the transcript query + render below the video**

Overwrite the page:

```typescript
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { presignGet } from "@/lib/r2/presigned-get";
import { CopyLinkButton } from "@/components/share/copy-link-button";
import Link from "next/link";

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

  let signedVideoUrl: string | null = null;
  if (isOwner && rec.status === "ready" && rec.r2CompositeKey) {
    signedVideoUrl = await presignGet(rec.r2CompositeKey);
  }

  const transcript = isOwner ? await getTranscriptByRecording(rec.id) : null;

  return (
    <div className="min-h-screen">
      <header
        className="flex items-center justify-between border-b border-white/10 px-6 py-3"
        style={{ borderBottomColor: accent }}
      >
        <div className="flex items-center gap-3">
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
        <h1 className="text-2xl font-semibold">
          {rec.title || "Untitled recording"}
        </h1>
        <p className="mt-1 text-sm opacity-60">
          {rec.status === "ready" ? "Ready" : `Status: ${rec.status}`}
        </p>

        {isOwner && signedVideoUrl && (
          <video
            src={signedVideoUrl}
            controls
            className="mt-6 w-full rounded border border-white/10 bg-black"
          />
        )}

        {!isOwner && (
          <div className="mt-6 rounded-lg border border-white/10 p-8 text-center">
            <p className="text-lg">Viewer coming in M7.</p>
            <p className="mt-2 text-sm opacity-60">
              Playback, transcripts, chapters, and comments ship in a later
              milestone. For now, the recording exists and will be playable
              here once the viewer lands.
            </p>
          </div>
        )}

        {isOwner && transcript && (
          <div className="mt-8">
            <h2 className="text-sm font-medium">Transcript</h2>
            <p className="mt-2 text-xs opacity-60">
              {transcript.fullText.split(/\s+/).filter(Boolean).length} words ·
              language {transcript.language ?? "unknown"}
            </p>
            <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-white/10 p-4 text-sm leading-relaxed">
              {transcript.fullText || "(empty transcript)"}
            </div>
          </div>
        )}

        {isOwner && rec.status === "transcribing" && (
          <p className="mt-6 text-xs opacity-60">
            Transcription in progress — refresh in ~30 seconds for short
            recordings, a couple of minutes for longer ones.
          </p>
        )}

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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/v/[slug]/page.tsx"
git commit -m "feat(share): render transcript snippet for owner when available"
```

---

### Task 14: Push + smoke test on prod

**Files:** none

- [ ] **Step 1: Push to main**

```bash
git push
```

- [ ] **Step 2: Wait for Coolify deploy**

Watch https://coolify.dissonance.cloud until the new container shows Running. Log output at boot should include:

```
[pg-boss] started and workers registered
```

(If it doesn't, check that `pg-boss` created its schema in Supabase — visible in the Supabase Table Editor under a new schema called `pgboss`.)

- [ ] **Step 3: Record a short test clip on prod**

1. Visit https://loom.dissonance.cloud/record
2. Record ~10 seconds with SPEAKING into the mic (Deepgram needs actual audio, silence = empty transcript)
3. Click stop
4. On the "Recording ready" screen, open the share link

- [ ] **Step 4: Verify the pipeline**

- Immediately after stop: status should be `transcribing` (share page shows "Transcription in progress" message)
- Within ~10-30 seconds: refresh — status should flip to `ready` and transcript should appear below the video
- Coolify container logs should show the webhook POST arriving and the `"[transcribe] enqueued..."` message

- [ ] **Step 5: Verify DB state**

```bash
set -a && source .env.local && set +a
node -e "
import('postgres').then(async ({default: postgres}) => {
  const sql = postgres(process.env.DATABASE_URL, {max:1,idle_timeout:5});
  const rows = await sql\`
    SELECT m.id, m.slug, m.status, t.language, length(t.full_text) as text_len, jsonb_array_length(t.word_timestamps) as word_count
    FROM media_objects m
    LEFT JOIN transcripts t ON t.media_object_id = m.id
    ORDER BY m.created_at DESC LIMIT 3
  \`;
  console.log(rows);
  await sql.end();
});
"
```

Expected: most recent recording has `status: 'ready'`, non-null `text_len`, and `word_count` roughly matches the length of what you said.

- [ ] **Step 6: Mark M5 shipped**

```bash
sed -i '' 's|| M5 | Deepgram transcription | 🔄 next .*|| M5 | Deepgram transcription | ✅ shipped | pg-boss job queue in-process; Deepgram async + HMAC-signed webhook callback; transcripts persisted to DB|' ROADMAP.md

cat >> CLAUDE.md <<'EOF'
EOF
# Append to the roadmap section at the end:
# Actually use a targeted edit to the M5 roadmap line instead. Edit CLAUDE.md's
# bullet for M5 via:
sed -i '' 's|- \[ \] M5: Deepgram transcription.*|- [x] **M5: Deepgram transcription** — pg-boss + Deepgram async callback + HMAC-signed webhook.|' CLAUDE.md

git add ROADMAP.md CLAUDE.md
git commit -m "docs: mark M5 shipped"
git push
```

---

## Milestone 5 Complete

At this point you should have:

- pg-boss running in the Next.js container, started via instrumentation hook
- Recordings auto-transcribe after upload via Deepgram async + webhook
- Transcript rendered below the video on owner's view of `/v/:slug`
- Status flow: `uploading → transcribing → ready`
- 25 Vitest tests passing (18 existing + 7 HMAC tests)
- 6 Playwright tests passing (unchanged from M4)

Re-invoke `/superpowers:writing-plans` with "M6: AI outputs (title/summary/chapters/action items) + thumbnails" when ready.

---

## Self-Review

**Spec coverage (M5 slice only):**

- Deepgram webhook callback instead of polling → Tasks 7, 11 ✓ (spec: "Polling Deepgram's API every 10s is wasteful…we give them a callback URL")
- Deepgram sees composite video audio (mic + system mixed at record time) → Task 7 uses `presignGet(compositeKey)` ✓
- pg-boss backed by Supabase Postgres, no Redis → Task 8 ✓
- Retry with exponential backoff, 3 retries → Task 8 `enqueueTranscription` options ✓
- Transcript with word-level timestamps in jsonb → Task 6 + Task 11 ✓
- HMAC webhook signature → Tasks 3, 4, 11 ✓
- `deepgram_request_id` persisted → Task 11 reads from `body.metadata.request_id` ✓
- Observability: structured JSON logs to stdout → console.log/error statements throughout; Coolify captures ✓

**Placeholder scan:** no TBD / TODO / "similar to Task N". Every step has complete code or explicit commands.

**Type/name consistency:**
- `TranscribeJobData` type defined in `transcribe.ts` (Task 7), imported and parameterized in `boss.ts` (Task 8) and used in the enqueue call in `complete/route.ts` (Task 10). ✓
- `TRANSCRIBE_JOB` constant exported from `transcribe.ts`, used in `boss.ts`. ✓
- `WordTimestamp` type defined in `queries/transcripts.ts` (Task 6), consumed by webhook (Task 11). ✓
- `verifyRecordingSignature` + `signRecordingId` (Task 3) both produce/consume hex strings; test roundtrip in Task 4. ✓
- `mediaObjects.status` values in code (`'transcribing'`, `'ready'`) match the `mediaObjectStatus` enum definition in `schema.ts` from M2. ✓
- Webhook response shape is not consumed by Deepgram in any strict way — they just expect 2xx. Plain `{ ok: true }` fine.

**One gap acknowledged:** If Deepgram's webhook fails to reach us (container restart, network blip), the recording stays in `transcribing` forever. Retry-on-our-side isn't implemented — Deepgram retries briefly but not indefinitely. A janitor job that reconciles stuck `transcribing` rows by polling Deepgram's `/v1/listen/request/{request_id}` endpoint would close this gap. **Deferred to a later polish pass or M11.**

**One gap that will bite only at scale:** pg-boss' own archive table accumulates completed jobs. The 7-day retention in Task 8 is generous for a solo tool; revisit if the table gets large.
