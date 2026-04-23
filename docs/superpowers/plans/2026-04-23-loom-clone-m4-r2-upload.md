# Loom Clone — Milestone 4: R2 Upload + Recordings List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload the 5 MediaRecorder tracks directly to Cloudflare R2 via multipart during recording, persist a `media_objects` row per recording, and surface a list of past recordings on the dashboard with a share-link stub viewer at `/v/:slug`.

**Architecture:** Browser accumulates `MediaRecorder` chunks into 5MB buckets and POSTs to a server endpoint for presigned S3 `UploadPart` URLs. The server (Next.js API routes) uses `@aws-sdk/client-s3` to initiate each multipart upload, generate part URLs on demand, and finalize the upload on stop. A single `upload_metadata` jsonb column on `media_objects` holds transient multipart state (upload IDs + collected ETags); it's cleared to `null` when all five uploads complete and the row transitions to `status='ready'`. The dashboard replaces its placeholder with a recording grid, and `/v/:slug` renders a dual-mode page: owners see a preview player using a signed R2 URL, non-owners see a "viewer coming in M7" stub with the share link + brand-color accent.

**Tech Stack:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, Cloudflare R2 (S3-compatible), Drizzle migration (new column), `nanoid`, Next.js App Router Route Handlers (`/api/recordings/*`), React Server Components for dashboard.

---

## File Structure (Milestone 4)

**New files:**

```
src/
├── lib/
│   ├── r2/
│   │   ├── client.ts                       # server-only S3 client + config
│   │   ├── multipart.ts                    # server helpers: createUpload, presignPart, completeUpload, abortUpload
│   │   └── presigned-get.ts                # signed GET URLs for playback (owner-only in M4)
│   ├── recording/
│   │   └── upload-coordinator.ts           # client-side: batch chunks + upload parts to presigned URLs
│   └── slug.ts                             # nanoid 10-char slug generator
├── db/
│   └── queries/
│       └── recordings.ts                   # listRecordings, getRecordingBySlug, updateRecording, deleteRecording
├── app/
│   ├── api/
│   │   └── recordings/
│   │       ├── start/route.ts              # POST — create row + multipart uploads
│   │       └── [id]/
│   │           ├── part-url/route.ts       # POST — presigned URL for a part
│   │           ├── complete/route.ts       # POST — finalize + mark ready
│   │           └── abort/route.ts          # POST — abort + mark failed
│   ├── page.tsx                            # MODIFY: query recordings, render list or empty state
│   └── v/
│       └── [slug]/page.tsx                 # share URL page (dual-mode: owner preview vs. public stub)
├── components/
│   ├── dashboard/
│   │   ├── empty-state.tsx                 # MODIFY: no longer the top-level; renders when 0 recordings
│   │   ├── recording-card.tsx              # grid card
│   │   └── recording-list.tsx              # grid layout + empty state delegation
│   ├── record/
│   │   ├── record-flow.tsx                 # MODIFY: wire /start → /complete, show upload progress
│   │   └── upload-progress.tsx             # NEW: per-track progress bars during finalize
│   └── share/
│       └── copy-link-button.tsx            # client: copy + flash confirmation

drizzle/
└── 0002_upload_metadata.sql                # ALTER TABLE media_objects ADD COLUMN upload_metadata jsonb

tests/
├── unit/
│   └── slug.test.ts                        # nanoid format + collision-resistance
└── e2e/
    └── recordings-list.spec.ts             # dashboard shows rows after a mocked DB insert
```

**File responsibility boundaries:**

- `src/lib/r2/client.ts` — single cached S3 client instance for R2. Reads env at module load is FINE here (server-only, env always present in Node).
- `src/lib/r2/multipart.ts` — stateless functions that wrap S3 multipart ops. No UI, no DB reads.
- `src/lib/r2/presigned-get.ts` — stateless function returning a signed GET URL for a given R2 key, TTL 1 hour.
- `src/lib/recording/upload-coordinator.ts` — pure client-side. No server imports. Takes a `Blob` chunk stream from `MediaRecorder`, batches, calls provided callbacks to fetch part URLs.
- `src/app/api/recordings/*/route.ts` — thin: auth check, parse body, call queries + multipart helpers. No business logic.
- `src/components/dashboard/recording-list.tsx` — renders the grid. Delegates to `empty-state.tsx` when `recordings.length === 0`.
- `src/app/v/[slug]/page.tsx` — owner vs. public branching happens here. Non-owners bounce off a signed GET URL requirement cleanly.

---

## Tasks

### Task 1: Cloudflare R2 setup (USER ACTION)

Cannot be automated unless `wrangler` is installed and authed. Agent should check `which wrangler` + `wrangler whoami` first; if both succeed, bucket creation can be scripted (see Step 1 alt). Otherwise, user does the dashboard path.

- [ ] **Step 1: Create bucket `loom-media` in your Cloudflare account**

Dashboard path:
1. Visit https://dash.cloudflare.com
2. R2 Object Storage → Create bucket
3. Name: `loom-media`
4. Location: automatic
5. Click Create

Alternative (if `wrangler` is authed):
```bash
wrangler r2 bucket create loom-media
```

- [ ] **Step 2: Configure CORS on the bucket**

Dashboard → R2 → `loom-media` bucket → Settings → CORS Policy → Edit:

```json
[
  {
    "AllowedOrigins": ["https://loom.dissonance.cloud", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The `ExposeHeaders: ["ETag"]` is critical — multipart upload needs ETag readable from the PUT response.

- [ ] **Step 3: Create R2 API token**

Dashboard → R2 → Manage R2 API Tokens → Create API Token:
- Name: `loom-clone`
- Permissions: **Object Read & Write**
- Specify bucket: `loom-media` only
- TTL: no expiry

Record four values from the token creation screen:
- `R2_ACCOUNT_ID` — your Cloudflare account ID (visible in dash URL or overview page)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_ENDPOINT` — `https://<account-id>.r2.cloudflarestorage.com` (standard R2 S3-compatible endpoint)

- [ ] **Step 4: Add values to Doppler `prd_loom` config**

Via https://dashboard.doppler.com/workplace/projects/dissonance-cloud/configs/prd_loom → add:

```
R2_ACCOUNT_ID=<value>
R2_ACCESS_KEY_ID=<value>
R2_SECRET_ACCESS_KEY=<value>
R2_BUCKET_NAME=loom-media
R2_PUBLIC_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

- [ ] **Step 5: Mirror the same vars into local `.env.local`** (append, don't overwrite existing contents)

```bash
cat >> /Users/iancross/Development/03Utilities/Loom_Clone/.env.local <<'EOF'

# Cloudflare R2 (M4)
R2_ACCOUNT_ID=<paste>
R2_ACCESS_KEY_ID=<paste>
R2_SECRET_ACCESS_KEY=<paste>
R2_BUCKET_NAME=loom-media
R2_PUBLIC_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
EOF
```

---

### Task 2: Install AWS SDK + nanoid

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
cd /Users/iancross/Development/03Utilities/Loom_Clone
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner nanoid
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @aws-sdk/client-s3 + s3-request-presigner + nanoid"
```

---

### Task 3: Slug generator

**Files:**
- Create: `src/lib/slug.ts`
- Create: `tests/unit/slug.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/slug.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateSlug } from "@/lib/slug";

describe("generateSlug", () => {
  it("returns a 10-character string", () => {
    expect(generateSlug()).toHaveLength(10);
  });

  it("uses URL-safe alphanumerics only", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSlug()).toMatch(/^[0-9a-zA-Z_-]+$/);
    }
  });

  it("produces distinct slugs on repeated calls", () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) set.add(generateSlug());
    expect(set.size).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- tests/unit/slug.test.ts
```
Expected: 3 tests fail with `module not found`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/slug.ts`:

```typescript
import { customAlphabet } from "nanoid";

// URL-safe alphanumerics, 10 chars → ~58 bits of entropy → collision-resistant
// for any realistic personal use (would need billions of records before 0.1% probability)
const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  10
);

export function generateSlug(): string {
  return nanoid();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test
```
Expected: 18 tests passing (15 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/slug.ts tests/unit/slug.test.ts
git commit -m "feat(util): nanoid slug generator"
```

---

### Task 4: Drizzle migration for `upload_metadata`

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0002_upload_metadata.sql` (auto-generated)
- Modify: `drizzle/meta/_journal.json` (auto-updated by drizzle-kit)

- [ ] **Step 1: Add the column to the schema**

Edit `src/db/schema.ts`, find the `media_objects` table, and add `uploadMetadata` right before `createdAt`:

```typescript
  passwordHash: text("password_hash"),
  uploadMetadata: jsonb("upload_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
```

- [ ] **Step 2: Generate migration**

```bash
set -a && source .env.local && set +a
npm run db:generate
```
Expected: creates `drizzle/0002_<name>.sql` with the `ALTER TABLE` statement, updates `drizzle/meta/_journal.json`.

- [ ] **Step 3: Inspect the generated SQL**

```bash
cat drizzle/0002_*.sql
```
Expected content includes: `ALTER TABLE "media_objects" ADD COLUMN "upload_metadata" jsonb;`

- [ ] **Step 4: Apply migration**

```bash
set -a && source .env.local && set +a
npm run db:migrate
```
Expected output: `migrations applied`.

- [ ] **Step 5: Verify the column exists**

```bash
set -a && source .env.local && set +a
node -e "
import('postgres').then(async ({default: postgres}) => {
  const sql = postgres(process.env.DATABASE_URL, {max:1,idle_timeout:5});
  const rows = await sql\`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'media_objects' AND column_name = 'upload_metadata'\`;
  console.log(rows);
  await sql.end();
});
"
```
Expected: one row with `data_type: 'jsonb'`.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add upload_metadata jsonb column to media_objects"
```

---

### Task 5: R2 S3 client module

**Files:**
- Create: `src/lib/r2/client.ts`

- [ ] **Step 1: Create the module**

```typescript
import { S3Client } from "@aws-sdk/client-s3";

let cached: S3Client | null = null;

/**
 * Returns a cached S3Client configured for Cloudflare R2. Throws if any
 * required env var is missing. Called from server routes only.
 */
export function getR2Client(): S3Client {
  if (cached) return cached;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 credentials (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)"
    );
  }

  cached = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return cached;
}

export function r2BucketName(): string {
  const name = process.env.R2_BUCKET_NAME;
  if (!name) throw new Error("R2_BUCKET_NAME is not set");
  return name;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/r2/client.ts
git commit -m "feat(r2): add S3 client factory for Cloudflare R2"
```

---

### Task 6: R2 multipart helpers (server)

**Files:**
- Create: `src/lib/r2/multipart.ts`

- [ ] **Step 1: Create the module**

```typescript
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, r2BucketName } from "./client";

export async function createMultipartUpload(
  key: string,
  contentType: string
): Promise<string> {
  const client = getR2Client();
  const res = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: r2BucketName(),
      Key: key,
      ContentType: contentType,
    })
  );
  if (!res.UploadId) {
    throw new Error("CreateMultipartUpload returned no UploadId");
  }
  return res.UploadId;
}

export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number
): Promise<string> {
  const client = getR2Client();
  const cmd = new UploadPartCommand({
    Bucket: r2BucketName(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(client, cmd, { expiresIn: 3600 });
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: CompletedPart[]
): Promise<void> {
  const client = getR2Client();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: r2BucketName(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  );
}

export async function abortMultipartUpload(
  key: string,
  uploadId: string
): Promise<void> {
  const client = getR2Client();
  try {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: r2BucketName(),
        Key: key,
        UploadId: uploadId,
      })
    );
  } catch {
    // Abort is best-effort; R2's lifecycle will clean orphaned parts
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
git add src/lib/r2/multipart.ts
git commit -m "feat(r2): add multipart upload server helpers"
```

---

### Task 7: Presigned GET helper

**Files:**
- Create: `src/lib/r2/presigned-get.ts`

- [ ] **Step 1: Create the module**

```typescript
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, r2BucketName } from "./client";

/**
 * Returns a signed GET URL valid for 1 hour. Used by the owner's preview
 * player in /v/:slug; the viewer page fetches fresh URLs as needed.
 */
export async function presignGet(key: string): Promise<string> {
  const client = getR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: r2BucketName(), Key: key }),
    { expiresIn: 3600 }
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
git add src/lib/r2/presigned-get.ts
git commit -m "feat(r2): add presigned GET helper"
```

---

### Task 8: Recordings query module

**Files:**
- Create: `src/db/queries/recordings.ts`

- [ ] **Step 1: Create the module**

```typescript
import { db } from "@/db";
import { mediaObjects, brandProfiles } from "@/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export type Recording = typeof mediaObjects.$inferSelect;
export type RecordingWithBrand = Recording & {
  brand: { id: string; name: string; accentColor: string } | null;
};

export async function listRecordings(
  ownerId: string
): Promise<RecordingWithBrand[]> {
  const rows = await db
    .select({
      rec: mediaObjects,
      brandId: brandProfiles.id,
      brandName: brandProfiles.name,
      brandAccent: brandProfiles.accentColor,
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .where(
      and(eq(mediaObjects.ownerId, ownerId), isNull(mediaObjects.deletedAt))
    )
    .orderBy(desc(mediaObjects.createdAt));

  return rows.map((r) => ({
    ...r.rec,
    brand: r.brandId
      ? { id: r.brandId, name: r.brandName!, accentColor: r.brandAccent! }
      : null,
  }));
}

export async function getRecordingBySlug(
  slug: string
): Promise<RecordingWithBrand | null> {
  const [row] = await db
    .select({
      rec: mediaObjects,
      brandId: brandProfiles.id,
      brandName: brandProfiles.name,
      brandAccent: brandProfiles.accentColor,
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .where(and(eq(mediaObjects.slug, slug), isNull(mediaObjects.deletedAt)))
    .limit(1);

  if (!row) return null;
  return {
    ...row.rec,
    brand: row.brandId
      ? { id: row.brandId, name: row.brandName!, accentColor: row.brandAccent! }
      : null,
  };
}

export async function getRecordingOwned(
  id: string,
  ownerId: string
): Promise<Recording | null> {
  const [row] = await db
    .select()
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function softDeleteRecording(
  id: string,
  ownerId: string
): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, ownerId)))
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/recordings.ts
git commit -m "feat(db): recordings query module"
```

---

### Task 9: POST /api/recordings/start

**Files:**
- Create: `src/app/api/recordings/start/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { generateSlug } from "@/lib/slug";
import { createMultipartUpload } from "@/lib/r2/multipart";
import type { TrackKind } from "@/lib/recording/types";

type StartRequest = {
  tracks: Array<{ kind: TrackKind; mimeType: string }>;
  resolution: string;
  durationEstimate?: number;
  brandProfileId: string | null;
};

type StartResponse = {
  recordingId: string;
  slug: string;
  uploads: Record<TrackKind, { key: string; uploadId: string } | undefined>;
};

function keyFor(slug: string, kind: TrackKind): string {
  const suffix = kind === "composite" ? "composite" : `raw/${kind}`;
  const ext =
    kind === "composite" || kind === "screen" || kind === "camera"
      ? "webm"
      : "webm"; // audio tracks are also webm/opus
  return `${slug}/${suffix}.${ext}`;
}

export async function POST(request: Request) {
  const user = await requireAuth();
  const body = (await request.json()) as StartRequest;

  if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
    return NextResponse.json({ error: "No tracks specified" }, { status: 400 });
  }

  const slug = generateSlug();
  const uploads: StartResponse["uploads"] = {
    composite: undefined,
    screen: undefined,
    camera: undefined,
    mic: undefined,
    "system-audio": undefined,
  };
  const uploadMetadata: Record<string, { uploadId: string; key: string; parts: never[] }> = {};

  for (const track of body.tracks) {
    const key = keyFor(slug, track.kind);
    const uploadId = await createMultipartUpload(key, track.mimeType);
    uploads[track.kind] = { key, uploadId };
    uploadMetadata[track.kind] = { uploadId, key, parts: [] };
  }

  const [row] = await db
    .insert(mediaObjects)
    .values({
      ownerId: user.id,
      type: "video",
      slug,
      status: "uploading",
      brandProfileId: body.brandProfileId,
      uploadMetadata,
    })
    .returning({ id: mediaObjects.id });

  const response: StartResponse = {
    recordingId: row.id,
    slug,
    uploads,
  };
  return NextResponse.json(response);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/recordings/start/route.ts
git commit -m "feat(api): POST /api/recordings/start — initiate multipart uploads"
```

---

### Task 10: POST /api/recordings/:id/part-url

**Files:**
- Create: `src/app/api/recordings/[id]/part-url/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingOwned } from "@/db/queries/recordings";
import { presignUploadPart } from "@/lib/r2/multipart";
import type { TrackKind } from "@/lib/recording/types";

type PartUrlRequest = {
  track: TrackKind;
  partNumber: number;
};

type UploadMeta = {
  [K in TrackKind]?: { uploadId: string; key: string; parts: unknown[] };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json()) as PartUrlRequest;

  if (!body.track || typeof body.partNumber !== "number") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (body.partNumber < 1 || body.partNumber > 10_000) {
    return NextResponse.json(
      { error: "partNumber out of range" },
      { status: 400 }
    );
  }

  const recording = await getRecordingOwned(id, user.id);
  if (!recording) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = recording.uploadMetadata as UploadMeta | null;
  const trackMeta = meta?.[body.track];
  if (!trackMeta) {
    return NextResponse.json(
      { error: `Track ${body.track} has no active upload` },
      { status: 400 }
    );
  }

  const url = await presignUploadPart(
    trackMeta.key,
    trackMeta.uploadId,
    body.partNumber
  );
  return NextResponse.json({ url, partNumber: body.partNumber });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/recordings/[id]/part-url/"
git commit -m "feat(api): POST /api/recordings/:id/part-url"
```

---

### Task 11: POST /api/recordings/:id/complete

**Files:**
- Create: `src/app/api/recordings/[id]/complete/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingOwned } from "@/db/queries/recordings";
import { completeMultipartUpload } from "@/lib/r2/multipart";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { TrackKind } from "@/lib/recording/types";

type CompleteRequest = {
  tracks: Partial<
    Record<TrackKind, Array<{ PartNumber: number; ETag: string }>>
  >;
  durationSeconds: number;
};

type UploadMeta = {
  [K in TrackKind]?: { uploadId: string; key: string; parts: unknown[] };
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
    return NextResponse.json(
      { error: "No active uploads" },
      { status: 400 }
    );
  }

  // Complete all multipart uploads in parallel
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

  await db
    .update(mediaObjects)
    .set({
      ...keyUpdates,
      durationSeconds: String(body.durationSeconds),
      status: "ready",
      uploadMetadata: null,
    })
    .where(
      and(eq(mediaObjects.id, recording.id), eq(mediaObjects.ownerId, user.id))
    );

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
git add "src/app/api/recordings/[id]/complete/"
git commit -m "feat(api): POST /api/recordings/:id/complete — finalize multipart"
```

---

### Task 12: POST /api/recordings/:id/abort

**Files:**
- Create: `src/app/api/recordings/[id]/abort/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingOwned } from "@/db/queries/recordings";
import { abortMultipartUpload } from "@/lib/r2/multipart";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { TrackKind } from "@/lib/recording/types";

type UploadMeta = {
  [K in TrackKind]?: { uploadId: string; key: string; parts: unknown[] };
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;

  const recording = await getRecordingOwned(id, user.id);
  if (!recording) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = recording.uploadMetadata as UploadMeta | null;
  if (meta) {
    const aborts: Promise<void>[] = [];
    for (const trackMeta of Object.values(meta)) {
      if (trackMeta) {
        aborts.push(abortMultipartUpload(trackMeta.key, trackMeta.uploadId));
      }
    }
    await Promise.all(aborts);
  }

  await db
    .update(mediaObjects)
    .set({ status: "failed", uploadMetadata: null })
    .where(
      and(eq(mediaObjects.id, recording.id), eq(mediaObjects.ownerId, user.id))
    );

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
git add "src/app/api/recordings/[id]/abort/"
git commit -m "feat(api): POST /api/recordings/:id/abort"
```

---

### Task 13: Upload coordinator (client)

**Files:**
- Create: `src/lib/recording/upload-coordinator.ts`

- [ ] **Step 1: Create the module**

```typescript
import type { TrackKind } from "./types";

const TARGET_PART_SIZE = 8 * 1024 * 1024; // 8MB per part; min is 5MB except last

export type TrackUploadInit = {
  kind: TrackKind;
  key: string;
  uploadId: string;
};

export type CompletedPart = { PartNumber: number; ETag: string };

export type UploadCoordinator = {
  /** Call whenever MediaRecorder.ondataavailable fires with a new Blob */
  pushChunk(kind: TrackKind, blob: Blob): void;
  /** Call when MediaRecorder.onstop fires — flushes remaining buffer */
  finalize(kind: TrackKind): Promise<void>;
  /** After all finalize() promises resolve, returns the assembled parts */
  getCompletedParts(): Partial<Record<TrackKind, CompletedPart[]>>;
  /** Overall progress across all tracks, 0-1 */
  onProgress(listener: (progress: number) => void): () => void;
};

export type PartUrlFetcher = (
  track: TrackKind,
  partNumber: number
) => Promise<string>;

type TrackState = {
  key: string;
  uploadId: string;
  buffer: Blob[];
  bufferSize: number;
  nextPartNumber: number;
  completedParts: CompletedPart[];
  inFlight: Promise<void>[];
  totalBytes: number;
  uploadedBytes: number;
};

export function createUploadCoordinator(
  inits: TrackUploadInit[],
  getPartUrl: PartUrlFetcher
): UploadCoordinator {
  const tracks = new Map<TrackKind, TrackState>();
  for (const init of inits) {
    tracks.set(init.kind, {
      key: init.key,
      uploadId: init.uploadId,
      buffer: [],
      bufferSize: 0,
      nextPartNumber: 1,
      completedParts: [],
      inFlight: [],
      totalBytes: 0,
      uploadedBytes: 0,
    });
  }

  const progressListeners = new Set<(progress: number) => void>();

  function reportProgress() {
    let total = 0;
    let uploaded = 0;
    for (const t of tracks.values()) {
      total += t.totalBytes;
      uploaded += t.uploadedBytes;
    }
    const ratio = total === 0 ? 0 : uploaded / total;
    for (const l of progressListeners) l(ratio);
  }

  async function uploadPart(
    kind: TrackKind,
    state: TrackState,
    partNumber: number,
    body: Blob
  ): Promise<void> {
    const url = await getPartUrl(kind, partNumber);
    const res = await fetch(url, { method: "PUT", body });
    if (!res.ok) {
      throw new Error(`Part ${partNumber} of ${kind} failed: ${res.status}`);
    }
    const etag = res.headers.get("ETag");
    if (!etag) {
      throw new Error(`Part ${partNumber} of ${kind} returned no ETag`);
    }
    state.completedParts.push({ PartNumber: partNumber, ETag: etag });
    state.uploadedBytes += body.size;
    reportProgress();
  }

  function flushBuffer(kind: TrackKind, state: TrackState, isFinal: boolean) {
    if (state.bufferSize === 0) return;
    if (!isFinal && state.bufferSize < TARGET_PART_SIZE) return;

    const body = new Blob(state.buffer);
    state.buffer = [];
    state.bufferSize = 0;
    const partNumber = state.nextPartNumber++;
    state.totalBytes += body.size;
    const promise = uploadPart(kind, state, partNumber, body);
    state.inFlight.push(promise);
  }

  return {
    pushChunk(kind, blob) {
      const state = tracks.get(kind);
      if (!state) return;
      state.buffer.push(blob);
      state.bufferSize += blob.size;
      flushBuffer(kind, state, false);
    },

    async finalize(kind) {
      const state = tracks.get(kind);
      if (!state) return;
      flushBuffer(kind, state, true);
      await Promise.all(state.inFlight);
      // Sort parts ascending by PartNumber per S3 protocol
      state.completedParts.sort((a, b) => a.PartNumber - b.PartNumber);
    },

    getCompletedParts() {
      const out: Partial<Record<TrackKind, CompletedPart[]>> = {};
      for (const [kind, state] of tracks.entries()) {
        out[kind] = state.completedParts.slice();
      }
      return out;
    },

    onProgress(listener) {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recording/upload-coordinator.ts
git commit -m "feat(recording): client upload coordinator for multipart R2 uploads"
```

---

### Task 14: Wire coordinator into recorder.ts

**Files:**
- Modify: `src/lib/recording/recorder.ts`

- [ ] **Step 1: Update the recorder to stream chunks through a coordinator**

Edit `src/lib/recording/recorder.ts`. Replace the entire `startRecording` function + `makeSlot` helper with a version that accepts a coordinator + recording ID. Full replacement of the file body (imports stay the same):

```typescript
import type {
  RecordingSettings,
  RecordingResult,
  RecordedTrack,
  TrackKind,
} from "./types";
import {
  captureScreen,
  captureCameraAndMic,
  captureMicOnly,
  stopStream,
  extractTracks,
  CaptureError,
} from "./capture-streams";
import { createAudioMixer } from "./audio-mixer";
import { startCompositor } from "./composite-canvas";
import type { UploadCoordinator } from "./upload-coordinator";

const VP9_MIME = "video/webm;codecs=vp9,opus";
const OPUS_MIME = "audio/webm;codecs=opus";

export type RecorderHandle = {
  stop: () => Promise<RecordingResult>;
  settled: Promise<void>;
};

type RecorderSlot = {
  kind: TrackKind;
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
};

export type StartRecordingOptions = {
  settings: RecordingSettings;
  /**
   * Optional: if provided, each MediaRecorder chunk is pushed into the
   * coordinator for streaming multipart upload to R2. Blobs are still
   * accumulated locally so the client has a `RecordingResult` at stop.
   */
  coordinator?: UploadCoordinator;
};

export async function startRecording(
  opts: StartRecordingOptions
): Promise<RecorderHandle> {
  const { settings, coordinator } = opts;

  const screenStream = await captureScreen(
    settings.resolution,
    settings.systemAudioEnabled
  );
  let camStream: MediaStream | null = null;
  if (settings.cameraEnabled) {
    camStream = await captureCameraAndMic(
      settings.cameraDeviceId,
      settings.micDeviceId
    );
  } else {
    camStream = await captureMicOnly(settings.micDeviceId);
  }

  const screenVideoOnly = extractTracks(screenStream, "video");
  const screenAudioOnly = extractTracks(screenStream, "audio");
  const cameraVideoOnly = settings.cameraEnabled
    ? extractTracks(camStream, "video")
    : null;
  const micOnly = extractTracks(camStream, "audio");

  const compositor = startCompositor(screenStream, camStream, settings);

  const mixer = createAudioMixer([micOnly, screenAudioOnly]);
  const compositeStream = new MediaStream([
    ...compositor.stream.getVideoTracks(),
    ...mixer.output.getAudioTracks(),
  ]);

  const slots: RecorderSlot[] = [];
  slots.push(makeSlot("composite", compositeStream, VP9_MIME, coordinator));
  if (screenVideoOnly)
    slots.push(makeSlot("screen", screenVideoOnly, VP9_MIME, coordinator));
  if (cameraVideoOnly)
    slots.push(makeSlot("camera", cameraVideoOnly, VP9_MIME, coordinator));
  if (micOnly) slots.push(makeSlot("mic", micOnly, OPUS_MIME, coordinator));
  if (screenAudioOnly)
    slots.push(
      makeSlot("system-audio", screenAudioOnly, OPUS_MIME, coordinator)
    );

  // 5-second timeslice so ondataavailable fires regularly for streaming uploads
  for (const s of slots) s.recorder.start(5000);

  const startTime = performance.now();
  let settledResolve: () => void = () => {};
  const settled = new Promise<void>((res) => (settledResolve = res));

  const stop = (): Promise<RecordingResult> =>
    new Promise<RecordingResult>((resolve) => {
      const durationSeconds = (performance.now() - startTime) / 1000;

      const stops = slots.map(
        (slot) =>
          new Promise<RecordedTrack>((resolveSlot) => {
            slot.recorder.addEventListener(
              "stop",
              () => {
                const blob = new Blob(slot.chunks, { type: slot.mimeType });
                resolveSlot({
                  kind: slot.kind,
                  blob,
                  mimeType: slot.mimeType,
                  sizeBytes: blob.size,
                });
              },
              { once: true }
            );
            slot.recorder.stop();
          })
      );

      Promise.all(stops).then(async (tracks) => {
        compositor.stop();
        mixer.dispose();
        stopStream(screenStream);
        stopStream(camStream);

        // Flush any buffered parts through the coordinator
        if (coordinator) {
          await Promise.all(
            tracks.map((t) => coordinator.finalize(t.kind))
          );
        }

        settledResolve();
        resolve({ durationSeconds, settings, tracks });
      });
    });

  const primaryScreenTrack = screenStream.getVideoTracks()[0];
  if (primaryScreenTrack) {
    primaryScreenTrack.addEventListener(
      "ended",
      () => {
        void stop();
      },
      { once: true }
    );
  }

  return { stop, settled };
}

function makeSlot(
  kind: TrackKind,
  stream: MediaStream,
  preferredMime: string,
  coordinator?: UploadCoordinator
): RecorderSlot {
  const mimeType = MediaRecorder.isTypeSupported(preferredMime)
    ? preferredMime
    : "";
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (evt) => {
    if (evt.data && evt.data.size > 0) {
      chunks.push(evt.data);
      coordinator?.pushChunk(kind, evt.data);
    }
  });
  return { kind, recorder, chunks, mimeType: mimeType || "video/webm" };
}

export { CaptureError };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recording/recorder.ts
git commit -m "feat(recording): stream MediaRecorder chunks through upload coordinator"
```

---

### Task 15: Upload progress component

**Files:**
- Create: `src/components/record/upload-progress.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

export function UploadProgress({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-4">
      <p className="text-lg font-semibold">Finalising upload…</p>
      <div className="w-full max-w-md">
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-red-500/80 transition-[width] duration-200"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        <p className="mt-2 text-center text-xs opacity-60">
          {Math.round(pct * 100)}%
        </p>
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
git add src/components/record/upload-progress.tsx
git commit -m "feat(record): upload progress component"
```

---

### Task 16: Wire upload flow into record-flow.tsx

**Files:**
- Modify: `src/components/record/record-flow.tsx`
- Modify: `src/lib/recording/types.ts` (add `uploading` state)

- [ ] **Step 1: Add the `uploading` state variant**

Edit `src/lib/recording/types.ts`:

```typescript
export type RecorderState =
  | { kind: "idle" }
  | { kind: "countdown"; secondsLeft: number }
  | { kind: "recording"; startedAt: number }
  | { kind: "uploading"; progress: number }
  | { kind: "finished"; slug: string; result: RecordingResult }
  | { kind: "error"; message: string };
```

Note: `finished` now carries the slug returned from /complete.

- [ ] **Step 2: Rewrite record-flow.tsx**

Replace the entire file with:

```typescript
"use client";

import { useCallback, useReducer, useRef } from "react";
import type {
  RecorderState,
  RecordingSettings,
  RecordingResult,
} from "@/lib/recording/types";
import {
  startRecording,
  type RecorderHandle,
} from "@/lib/recording/recorder";
import { CaptureError } from "@/lib/recording/capture-streams";
import {
  createUploadCoordinator,
  type UploadCoordinator,
  type TrackUploadInit,
} from "@/lib/recording/upload-coordinator";
import type { BrandProfile } from "@/db/queries/brand-profiles";
import { PreRecordForm } from "./pre-record-form";
import { Countdown } from "./countdown";
import { RecordingHud } from "./recording-hud";
import { FinishedView } from "./finished-view";
import { UploadProgress } from "./upload-progress";

type Action =
  | { type: "start-countdown"; settings: RecordingSettings }
  | { type: "begin-recording"; startedAt: number }
  | { type: "begin-upload" }
  | { type: "upload-progress"; progress: number }
  | { type: "finish"; slug: string; result: RecordingResult }
  | { type: "error"; message: string }
  | { type: "reset" };

function reducer(state: RecorderState, action: Action): RecorderState {
  switch (action.type) {
    case "start-countdown":
      return { kind: "countdown", secondsLeft: 3 };
    case "begin-recording":
      return { kind: "recording", startedAt: action.startedAt };
    case "begin-upload":
      return { kind: "uploading", progress: 0 };
    case "upload-progress":
      return state.kind === "uploading"
        ? { kind: "uploading", progress: action.progress }
        : state;
    case "finish":
      return { kind: "finished", slug: action.slug, result: action.result };
    case "error":
      return { kind: "error", message: action.message };
    case "reset":
      return { kind: "idle" };
  }
}

export function RecordFlow({ brands }: { brands: BrandProfile[] }) {
  const [state, dispatch] = useReducer(reducer, { kind: "idle" } as RecorderState);
  const handleRef = useRef<RecorderHandle | null>(null);
  const coordinatorRef = useRef<UploadCoordinator | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const pendingSettingsRef = useRef<RecordingSettings | null>(null);

  const onStart = useCallback((settings: RecordingSettings) => {
    pendingSettingsRef.current = settings;
    dispatch({ type: "start-countdown", settings });
  }, []);

  const onCountdownDone = useCallback(async () => {
    const settings = pendingSettingsRef.current;
    if (!settings) return;
    try {
      // Kick off server-side multipart uploads
      const tracksRequested: Array<{
        kind: TrackUploadInit["kind"];
        mimeType: string;
      }> = [
        { kind: "composite", mimeType: "video/webm;codecs=vp9,opus" },
        { kind: "screen", mimeType: "video/webm;codecs=vp9,opus" },
        { kind: "mic", mimeType: "audio/webm;codecs=opus" },
      ];
      if (settings.cameraEnabled) {
        tracksRequested.push({
          kind: "camera",
          mimeType: "video/webm;codecs=vp9,opus",
        });
      }
      if (settings.systemAudioEnabled) {
        tracksRequested.push({
          kind: "system-audio",
          mimeType: "audio/webm;codecs=opus",
        });
      }

      const startRes = await fetch("/api/recordings/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: tracksRequested,
          resolution: settings.resolution,
          brandProfileId: settings.brandProfileId,
        }),
      });
      if (!startRes.ok) {
        throw new Error(`start failed: ${startRes.status}`);
      }
      const startData = (await startRes.json()) as {
        recordingId: string;
        slug: string;
        uploads: Record<
          string,
          { key: string; uploadId: string } | undefined
        >;
      };

      recordingIdRef.current = startData.recordingId;

      const inits: TrackUploadInit[] = [];
      for (const t of tracksRequested) {
        const u = startData.uploads[t.kind];
        if (u) inits.push({ kind: t.kind, key: u.key, uploadId: u.uploadId });
      }

      const coordinator = createUploadCoordinator(
        inits,
        async (track, partNumber) => {
          const res = await fetch(
            `/api/recordings/${startData.recordingId}/part-url`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ track, partNumber }),
            }
          );
          if (!res.ok) throw new Error(`part-url failed: ${res.status}`);
          const data = (await res.json()) as { url: string };
          return data.url;
        }
      );
      coordinatorRef.current = coordinator;

      const handle = await startRecording({ settings, coordinator });
      handleRef.current = handle;
      dispatch({ type: "begin-recording", startedAt: performance.now() });
    } catch (err) {
      const message =
        err instanceof CaptureError
          ? err.message
          : `Failed to start recording: ${String(err)}`;
      dispatch({ type: "error", message });
    }
  }, []);

  const onStop = useCallback(async () => {
    const handle = handleRef.current;
    const coordinator = coordinatorRef.current;
    const recordingId = recordingIdRef.current;
    if (!handle || !coordinator || !recordingId) return;

    const result = await handle.stop();
    handleRef.current = null;

    dispatch({ type: "begin-upload" });
    const unsubscribe = coordinator.onProgress((progress) => {
      dispatch({ type: "upload-progress", progress });
    });

    try {
      // Coordinator's finalize already ran inside handle.stop(); collect parts
      const completed = coordinator.getCompletedParts();
      const res = await fetch(`/api/recordings/${recordingId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: completed,
          durationSeconds: result.durationSeconds,
        }),
      });
      if (!res.ok) throw new Error(`complete failed: ${res.status}`);
      const data = (await res.json()) as { slug: string };
      unsubscribe();
      dispatch({ type: "finish", slug: data.slug, result });
    } catch (err) {
      unsubscribe();
      // Best-effort abort on server
      await fetch(`/api/recordings/${recordingId}/abort`, { method: "POST" });
      dispatch({
        type: "error",
        message: `Upload failed: ${String(err)}`,
      });
    }
  }, []);

  const onReset = useCallback(() => {
    handleRef.current = null;
    coordinatorRef.current = null;
    recordingIdRef.current = null;
    pendingSettingsRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  if (state.kind === "idle") {
    return <PreRecordForm brands={brands} onStart={onStart} />;
  }
  if (state.kind === "countdown") {
    return <Countdown seconds={state.secondsLeft} onComplete={onCountdownDone} />;
  }
  if (state.kind === "recording") {
    return <RecordingHud startedAt={state.startedAt} onStop={onStop} />;
  }
  if (state.kind === "uploading") {
    return <UploadProgress progress={state.progress} />;
  }
  if (state.kind === "finished") {
    return <FinishedView slug={state.slug} result={state.result} onReset={onReset} />;
  }
  return (
    <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
      <h2 className="text-xl font-semibold">Couldn&apos;t complete recording</h2>
      <p className="text-sm opacity-70">{state.message}</p>
      <button
        type="button"
        onClick={onReset}
        className="rounded border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Update finished-view to accept slug + link to /v/:slug**

Replace the top of `src/components/record/finished-view.tsx`'s signature + render:

```typescript
"use client";

import { useEffect, useState } from "react";
import type { RecordingResult, TrackKind } from "@/lib/recording/types";
import Link from "next/link";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function trackLabel(kind: TrackKind): string {
  switch (kind) {
    case "composite": return "Composite (share-ready)";
    case "screen": return "Raw screen video";
    case "camera": return "Raw camera video";
    case "mic": return "Raw microphone audio";
    case "system-audio": return "Raw system audio";
  }
}

export function FinishedView({
  slug,
  result,
  onReset,
}: {
  slug: string;
  result: RecordingResult;
  onReset: () => void;
}) {
  const [urls] = useState(() =>
    result.tracks.map((t) => ({
      kind: t.kind,
      url: URL.createObjectURL(t.blob),
      sizeBytes: t.sizeBytes,
      mimeType: t.mimeType,
    }))
  );

  useEffect(() => {
    return () => {
      for (const u of urls) URL.revokeObjectURL(u.url);
    };
  }, [urls]);

  const composite = urls.find((u) => u.kind === "composite");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Recording ready</h2>
        <p className="mt-1 text-sm opacity-60">
          Duration: {result.durationSeconds.toFixed(1)}s · Resolution:{" "}
          {result.settings.resolution.toUpperCase()} · Uploaded to your account
        </p>
      </div>

      <div className="rounded-lg border border-white/10 p-4">
        <p className="text-sm font-medium">Share link</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 rounded bg-white/5 px-3 py-2 text-sm">
            /v/{slug}
          </code>
          <Link
            href={`/v/${slug}`}
            className="rounded bg-white/90 px-3 py-2 text-sm font-medium text-black hover:bg-white"
          >
            Open
          </Link>
        </div>
      </div>

      {composite && (
        <video
          src={composite.url}
          controls
          className="w-full rounded border border-white/10 bg-black"
        />
      )}

      <div>
        <h3 className="text-sm font-medium">Local downloads (also on R2)</h3>
        <ul className="mt-2 grid gap-2">
          {urls.map((u) => (
            <li
              key={u.kind}
              className="flex items-center justify-between rounded border border-white/10 p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{trackLabel(u.kind)}</div>
                <div className="mt-0.5 text-xs opacity-60">
                  {u.mimeType} · {formatBytes(u.sizeBytes)}
                </div>
              </div>
              <a
                href={u.url}
                download={`loom-${result.settings.resolution}-${u.kind}.webm`}
                className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/5"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="rounded border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
      >
        New recording
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recording/types.ts src/components/record/record-flow.tsx src/components/record/finished-view.tsx
git commit -m "feat(record): wire upload pipeline into state machine"
```

---

### Task 17: Copy-link button component

**Files:**
- Create: `src/components/share/copy-link-button.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useState } from "react";

export function CopyLinkButton({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard may be blocked in iframes / old browsers; noop
        }
      }}
      className={
        className ??
        "rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/5"
      }
    >
      {copied ? "Copied!" : "Copy share link"}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/share/copy-link-button.tsx
git commit -m "feat(share): copy link button"
```

---

### Task 18: Dashboard recording list + card

**Files:**
- Create: `src/components/dashboard/recording-card.tsx`
- Create: `src/components/dashboard/recording-list.tsx`

- [ ] **Step 1: Create the card**

```typescript
import Link from "next/link";
import type { RecordingWithBrand } from "@/db/queries/recordings";

function formatDuration(seconds: string | number | null): string {
  if (seconds === null) return "—";
  const n = typeof seconds === "string" ? parseFloat(seconds) : seconds;
  if (!isFinite(n)) return "—";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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

const STATUS_STYLES: Record<string, string> = {
  uploading: "bg-blue-500/20 text-blue-200",
  transcribing: "bg-yellow-500/20 text-yellow-200",
  processing: "bg-yellow-500/20 text-yellow-200",
  ready: "bg-emerald-500/20 text-emerald-200",
  failed: "bg-red-500/20 text-red-200",
};

export function RecordingCard({ rec }: { rec: RecordingWithBrand }) {
  return (
    <Link
      href={`/v/${rec.slug}`}
      className="flex flex-col gap-3 rounded-lg border border-white/10 p-4 hover:border-white/30"
      style={
        rec.brand
          ? { borderLeftColor: rec.brand.accentColor, borderLeftWidth: 4 }
          : undefined
      }
    >
      <div className="flex aspect-video w-full items-center justify-center rounded bg-white/5 text-xs opacity-40">
        No thumbnail yet
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-medium">
            {rec.title || "Untitled recording"}
          </h3>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
              STATUS_STYLES[rec.status] ?? "bg-white/10"
            }`}
          >
            {rec.status}
          </span>
        </div>
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
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create the list**

```typescript
import Link from "next/link";
import type { RecordingWithBrand } from "@/db/queries/recordings";
import { RecordingCard } from "./recording-card";

export function RecordingList({ recordings }: { recordings: RecordingWithBrand[] }) {
  if (recordings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/15 p-10 text-center">
        <p className="text-sm opacity-70">No recordings yet.</p>
        <Link
          href="/record"
          className="mt-3 inline-block rounded bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          Start a recording
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      {recordings.map((r) => (
        <li key={r.id}>
          <RecordingCard rec={r} />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/recording-card.tsx src/components/dashboard/recording-list.tsx
git commit -m "feat(dashboard): recording card + list components"
```

---

### Task 19: Replace dashboard placeholder with real list

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Rewrite the page**

```typescript
import { requireAuth } from "@/lib/require-auth";
import { listRecordings } from "@/db/queries/recordings";
import { TopNav } from "@/components/nav/top-nav";
import { RecordingList } from "@/components/dashboard/recording-list";
import Link from "next/link";

export default async function HomePage() {
  const user = await requireAuth();
  const recordings = await listRecordings(user.id);
  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="recordings" />
      <div className="mx-auto max-w-5xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Recordings</h1>
            <p className="mt-1 text-sm opacity-60">
              {recordings.length === 0
                ? "Browser-based recording; branded share pages."
                : `${recordings.length} recording${recordings.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <Link
            href="/record"
            className="rounded bg-red-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            New recording
          </Link>
        </div>
        <div className="mt-6">
          <RecordingList recordings={recordings} />
        </div>
      </div>
    </>
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
git add src/app/page.tsx
git commit -m "feat(dashboard): replace placeholder with real recording list"
```

---

### Task 20: Create /v/[slug] dual-mode page

**Files:**
- Create: `src/app/v/[slug]/page.tsx`
- Create: `src/app/v/[slug]/not-found.tsx`

- [ ] **Step 1: Create not-found**

```typescript
import Link from "next/link";

export default function RecordingNotFound() {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-xl font-semibold">Recording not found</h1>
      <p className="mt-2 text-sm opacity-60">
        This link is broken or the recording has been deleted.
      </p>
      <Link href="/" className="mt-6 inline-block text-sm underline">
        Back home
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

```typescript
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
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

  // Owner preview: signed GET for composite
  let signedVideoUrl: string | null = null;
  if (isOwner && rec.status === "ready" && rec.r2CompositeKey) {
    signedVideoUrl = await presignGet(rec.r2CompositeKey);
  }

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
          <Link
            href="/"
            className="text-xs opacity-60 hover:opacity-100"
          >
            Back to dashboard
          </Link>
        )}
      </header>

      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">
          {rec.title || "Untitled recording"}
        </h1>
        <p className="mt-1 text-sm opacity-60">
          {rec.status === "ready"
            ? "Ready"
            : `Status: ${rec.status}`}
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
              Playback, transcripts, chapters, and comments ship in a later milestone.
              For now, the recording exists and will be playable here once the viewer lands.
            </p>
          </div>
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

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add "src/app/v/[slug]/"
git commit -m "feat(share): /v/[slug] dual-mode page (owner preview + public stub)"
```

---

### Task 21: Allow public access to /v/[slug] via middleware

**Files:**
- Modify: `src/lib/supabase/middleware.ts`

Currently the middleware redirects any unauthenticated user to `/login` except for specific allowlist routes. `/v/:slug` must be public.

- [ ] **Step 1: Add `/v/` to the public route check**

In `src/lib/supabase/middleware.ts`, find the `isAuthRoute` check and widen the condition:

```typescript
  const url = request.nextUrl.clone();
  const isAuthRoute = url.pathname.startsWith("/login") ||
                      url.pathname.startsWith("/auth");
  const isApiHealth = url.pathname === "/api/health";
  const isPublicShare = url.pathname.startsWith("/v/");

  if (!user && !isAuthRoute && !isApiHealth && !isPublicShare) {
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
git commit -m "feat(auth): allow unauthenticated access to /v/[slug]"
```

---

### Task 22: E2E test for recordings list (with mocked insert)

**Files:**
- Create: `tests/e2e/recordings-list.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("recordings dashboard", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "requires TEST_CREATOR_EMAIL + TEST_CREATOR_PASSWORD env vars"
  );

  test("dashboard renders list or empty state", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Recordings" })).toBeVisible();
    // Either the "No recordings yet" message OR at least one card is visible
    const empty = page.getByText("No recordings yet.");
    const cards = page.locator('a[href^="/v/"]');
    await expect(async () => {
      const emptyVisible = await empty.isVisible().catch(() => false);
      const cardCount = await cards.count();
      expect(emptyVisible || cardCount > 0).toBe(true);
    }).toPass({ timeout: 5_000 });
  });
});
```

- [ ] **Step 2: Run the E2E test**

```bash
set -a && source .env.local && set +a
npm run test:e2e -- tests/e2e/recordings-list.spec.ts
```
Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/recordings-list.spec.ts
git commit -m "test(e2e): recordings dashboard renders list or empty state"
```

---

### Task 23: Manual smoke test

**Files:** none

This is the full-pipeline verification. Run locally before pushing.

- [ ] **Step 1: Start dev server with R2 credentials loaded**

```bash
set -a && source .env.local && set +a
npm run dev
```

- [ ] **Step 2: Record a short test clip**

1. Log in at http://localhost:3000
2. Click "New recording"
3. Default settings (1080p, camera on, bubble at bottom-right, system audio OFF — keeps it simple)
4. Click Start recording
5. Grant permissions, pick the display / tab to share
6. Record for ~10 seconds
7. Click Stop

- [ ] **Step 3: Verify the upload + transition**

Expected UI flow: countdown → recording HUD → "Finalising upload…" with progress bar → "Recording ready" with share link like `/v/XYZ123abc0`.

- [ ] **Step 4: Click the share link**

- As the owner (logged in), you see the composite video playing from a signed R2 URL.
- Open an incognito window → same URL → you see "Viewer coming in M7" stub.

- [ ] **Step 5: Verify R2 contents**

Dashboard → R2 → `loom-media` → navigate into `<slug>/` → should see `composite.webm` (and raw files under `raw/`).

- [ ] **Step 6: Verify database row**

```bash
set -a && source .env.local && set +a
node -e "
import('postgres').then(async ({default: postgres}) => {
  const sql = postgres(process.env.DATABASE_URL, {max:1,idle_timeout:5});
  const rows = await sql\`SELECT id, slug, status, r2_composite_key, duration_seconds, upload_metadata FROM media_objects ORDER BY created_at DESC LIMIT 3\`;
  console.log(rows);
  await sql.end();
});
"
```
Expected: most recent row has `status: 'ready'`, `upload_metadata: null`, `r2_composite_key: '<slug>/composite.webm'`.

- [ ] **Step 7: Verify dashboard list**

Back at http://localhost:3000 — the new recording appears as a card with duration + "ready" status chip + brand badge (if selected).

---

### Task 24: Deploy + verify live

**Files:** none (pushes existing commits)

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Wait for Coolify**

Watch https://coolify.dissonance.cloud until Running. The migration `0002_upload_metadata` will apply automatically at container boot.

- [ ] **Step 3: Test on prod**

Repeat the Task 23 smoke test against https://loom.dissonance.cloud. Record a short clip, verify upload, verify share page in a logged-out incognito.

- [ ] **Step 4: Mark M4 shipped in ROADMAP.md**

```bash
sed -i '' 's|| M4 | R2 upload + recordings list | 🔄 next .*|| M4 | R2 upload + recordings list | ✅ shipped | Multipart upload during recording, media_objects row per recording, dashboard grid, /v/:slug dual-mode share page|' ROADMAP.md
git add ROADMAP.md
git commit -m "docs: mark M4 shipped"
git push
```

---

## Milestone 4 Complete

At this point you should have:

- 5-track multipart upload streaming directly from browser to R2
- `media_objects` rows created per recording with all 5 R2 keys
- Dashboard showing a grid of past recordings
- `/v/:slug` share page that owners can preview, public visitors see a stub
- 6 E2E tests passing (including new recordings-list test)
- 18 Vitest tests passing (15 existing + 3 slug tests)
- CLAUDE.md + ROADMAP.md updated

Re-invoke `/superpowers:writing-plans` with "M5: Deepgram transcription" when ready.

---

## Self-Review

**Spec coverage:**

- Browser uploads directly to R2 via presigned URLs during recording (spec: "Upload during recording, not after") → Tasks 13, 14, 16 ✓
- `@aws-sdk/lib-storage Upload class` was the spec's suggested pattern; I chose presigned-URL-per-part because `lib-storage` doesn't work well in browsers (needs raw credentials). Same outcome: streaming multipart during recording. ✓
- Parallel MediaRecorders outputting to separate R2 keys → Task 9's `keyFor()` routes each track to its own key ✓
- `media_objects` row lifecycle: create on start (uploading) → update on complete (ready) → update on abort (failed) → Tasks 9, 11, 12 ✓
- `r2_composite_key`, `r2_screen_key`, `r2_camera_key`, `r2_mic_key`, `r2_systemaudio_key` all populated on complete → Task 11 ✓
- Slug generation via nanoid (10 chars per spec) → Task 3 ✓
- Dashboard filter/search mentioned in spec: **DEFERRED** to a later polish pass. M4 ships a grid without filters. Noted as gap.
- Private R2 bucket with signed URL issuance → Task 20 uses `presignGet` ✓
- `deletedAt` soft delete via query `listRecordings` → Task 8 ✓
- Brand profile applied as accent color on share page header → Task 20 uses `rec.brand.accentColor` as border ✓
- Custom domain support (Layer 4 branding): **OUT OF SCOPE** per roadmap — deferred to a later spec ✓

**Placeholder scan:** No TBD / TODO / "similar to Task N" / "implement later" appearing in the plan. Every step has complete code or explicit external-UI instructions.

**Type/name consistency:**
- `TrackKind` type (defined in M3's types.ts) consumed by Tasks 9, 10, 11, 12, 13, 14 — all 5 values handled in every switch/lookup. ✓
- `UploadCoordinator` interface (Task 13) produced by `createUploadCoordinator`, consumed by Task 14 (`recorder.ts`), Task 16 (`record-flow.tsx`). Signature matches. ✓
- `TrackUploadInit` (Task 13) produced by Task 16 via `/api/recordings/start` response, passed to `createUploadCoordinator`. ✓
- `CompletedPart` (Task 13) `{ PartNumber, ETag }` matches server's `S3 CompletedPart` shape (Task 11). ✓
- `RecorderHandle` (Task 14) — `stop(): Promise<RecordingResult>` — RecordingResult shape from M3's types.ts unchanged in M4 (still `{ durationSeconds, settings, tracks }`). Consumer in Task 16 reads `result.durationSeconds` for the complete call. ✓
- `RecorderState` (Task 16 Step 1) adds `uploading` + `finished.slug` — all five variants handled in reducer (Task 16 Step 2) and render switch. ✓
- `FinishedView` component (Task 16 Step 3) takes `slug` prop — record-flow passes it from the finish action. ✓
- `RecordingWithBrand` (Task 8) — `.brand` is `{ id, name, accentColor } | null`. Consumed by Task 18 (`RecordingCard`) and Task 20 (share page). Both handle null correctly. ✓
- `StartResponse.uploads` (Task 9) is `Record<TrackKind, { key, uploadId } | undefined>`. Task 16 narrows with `if (u)` before creating `TrackUploadInit`. ✓
- `getRecordingOwned` vs `getRecordingBySlug` — different signatures for different callers (ownership-required APIs vs. public share page). Kept distinct intentionally. ✓
- `uploadMetadata` jsonb column type in schema (Task 4) — Drizzle infers it as `unknown` by default, and every consumer casts to `UploadMeta` locally. Not ideal but avoids global type noise for a transient field. ✓

**One risk not covered by any task (flagged for later):**

If the user's browser tab closes mid-recording (reload, crash, navigation), the recording row stays `status='uploading'` indefinitely with `upload_metadata` populated. There's no janitor job to abort orphaned uploads. Acceptable for M4; M5 or later should add a scheduled `pg-boss` job that aborts multipart uploads for rows stuck in `uploading` for >24 hours.
