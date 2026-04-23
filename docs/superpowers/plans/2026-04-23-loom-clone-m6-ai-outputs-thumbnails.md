# Loom Clone — Milestone 6: AI Outputs + Thumbnails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After transcription lands, generate an AI title + summary, chapter markers, action items, and a thumbnail in parallel, persist them to the existing `ai_outputs` and `media_objects` tables, and flip status from `processing` to `ready` when all four finish.

**Architecture:** The Deepgram webhook (from M5) now inserts a blank `ai_outputs` row and enqueues four pg-boss jobs instead of flipping status to `ready`. Three LLM jobs use the Vercel AI SDK + Claude Sonnet 4.6 with `generateObject()` against Zod schemas — no string parsing, no hallucinated JSON. The fourth job invokes `ffmpeg-static` on the signed R2 URL to grab a JPG frame at the 1-second mark (via HTTP range reads, no full download), uploads it to R2, and stores the key. Each job, after its UPDATE, checks if the four ai_outputs columns + `composite_thumbnail_key` are all populated and flips status to `ready` if so — idempotent, last-one-wins.

**Tech Stack:** `ai` + `@ai-sdk/anthropic`, Zod, `ffmpeg-static`, `node:child_process` for ffmpeg invocation, existing pg-boss + R2 + Drizzle setup.

---

## File Structure (Milestone 6)

**New files:**

```
src/
├── lib/
│   ├── ai/
│   │   ├── client.ts                          # Vercel AI SDK model factory
│   │   └── schemas.ts                         # Zod schemas for each structured output
│   ├── queue/
│   │   ├── jobs/
│   │   │   ├── generate-title-summary.ts
│   │   │   ├── generate-chapters.ts
│   │   │   ├── extract-action-items.ts
│   │   │   └── generate-thumbnail.ts
│   │   └── enqueue-processing.ts              # fans out all 4 jobs for a recording
│   └── r2/
│       └── upload-bytes.ts                    # helper: PutObject for a Buffer/Uint8Array
└── db/
    └── queries/
        └── ai-outputs.ts                      # CRUD for ai_outputs rows

tests/
└── unit/
    ├── ai-schemas.test.ts                    # Zod schema round-trip validation
    └── chapter-timing.test.ts                # start_sec clamping helpers
```

**Modified files:**

- `src/lib/queue/boss.ts` — register 4 new queues + workers
- `src/app/api/webhooks/deepgram/[recordingId]/[sig]/route.ts` — insert empty ai_outputs row + enqueue fan-out, flip to `processing` instead of `ready`
- `src/db/queries/recordings.ts` — `listRecordings` + `getRecordingBySlug` now left-join `ai_outputs` so cards + share page can render AI metadata
- `src/components/dashboard/recording-card.tsx` — prefer `ai_outputs.title_suggested` when `media_objects.title` is null; render thumbnail via signed URL if present
- `src/app/v/[slug]/page.tsx` — render summary / chapters / action items sections for owner
- `src/app/page.tsx` — resolve signed thumbnail URLs for each card server-side

**File responsibility boundaries:**

- `src/lib/ai/client.ts` — picks the right SDK provider + model based on env vars. Pure factory, no side effects beyond caching.
- `src/lib/ai/schemas.ts` — three Zod schemas, one per LLM output. Also exports TypeScript types inferred from them.
- `src/lib/queue/jobs/*.ts` — each file is one self-contained job handler. They all take a payload shape of `{ mediaObjectId }` and fetch the transcript + media row inside. No shared state.
- `src/lib/queue/enqueue-processing.ts` — called from the Deepgram webhook to send all four jobs. Centralized so queue names + options live in one place.
- `src/lib/r2/upload-bytes.ts` — simple PutObject wrapper used by the thumbnail job.
- `src/db/queries/ai-outputs.ts` — CRUD specific to this table. Each LLM job + the webhook call through here.

---

## Tasks

### Task 1: Anthropic API key (USER ACTION)

- [ ] **Step 1: Fund or verify your Anthropic API account**

1. https://console.anthropic.com → Billing → ensure there's a payment method + at least $5 of credits. (Claude Max subscription does not cover API usage.)
2. API Keys → Create Key → name it `loom-clone`, scope to default workspace
3. Copy the key

- [ ] **Step 2: Add to Doppler**

https://dashboard.doppler.com/workplace/projects/dissonance-cloud/configs/prd_loom → add:

```
ANTHROPIC_API_KEY=<key>
LLM_MODEL_ID=claude-sonnet-4-6
```

`LLM_MODEL_ID` is decoupled from the code so you can swap models without redeploying — just change Doppler + restart the container.

- [ ] **Step 3: Mirror to `.env.local`**

Append to `/Users/iancross/Development/03Utilities/Loom_Clone/.env.local`:

```
ANTHROPIC_API_KEY=<same>
LLM_MODEL_ID=claude-sonnet-4-6
```

Tell the agent "done" when all three steps are complete.

---

### Task 2: Install AI SDK + ffmpeg-static

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
cd /Users/iancross/Development/03Utilities/Loom_Clone
npm install ai @ai-sdk/anthropic ffmpeg-static
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ai sdk, @ai-sdk/anthropic, ffmpeg-static"
```

---

### Task 3: Vercel AI SDK client factory

**Files:**
- Create: `src/lib/ai/client.ts`

- [ ] **Step 1: Create the module**

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

let cached: LanguageModel | null = null;

/**
 * Returns a cached LanguageModel configured from env. Defaults to
 * claude-sonnet-4-6 on the Anthropic provider. Swapping providers/models
 * is a config change — set LLM_PROVIDER + LLM_MODEL_ID in Doppler.
 */
export function getLlm(): LanguageModel {
  if (cached) return cached;
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  const modelId = process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const anthropic = createAnthropic({ apiKey });
    cached = anthropic(modelId);
    return cached;
  }

  throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/client.ts
git commit -m "feat(ai): LanguageModel factory with provider env switching"
```

---

### Task 4: Zod schemas for structured outputs

**Files:**
- Create: `src/lib/ai/schemas.ts`

- [ ] **Step 1: Create the schemas**

```typescript
import { z } from "zod";

export const titleSummarySchema = z.object({
  title: z
    .string()
    .min(3)
    .max(120)
    .describe("A concise, descriptive title — 3 to 12 words, sentence case, no trailing period."),
  summary: z
    .string()
    .min(10)
    .max(600)
    .describe("A 2-3 sentence summary of what the recording covers."),
});

export type TitleSummary = z.infer<typeof titleSummarySchema>;

export const chaptersSchema = z.object({
  chapters: z
    .array(
      z.object({
        start_sec: z
          .number()
          .min(0)
          .describe("Start timestamp in seconds, must be within recording duration."),
        title: z
          .string()
          .min(2)
          .max(80)
          .describe("Chapter title — 2 to 10 words, sentence case, no trailing period."),
      })
    )
    .describe(
      "Chapter markers. Return an EMPTY array if the recording is too short (< 60s) or single-topic with no natural divisions."
    ),
});

export type Chapters = z.infer<typeof chaptersSchema>;

export const actionItemsSchema = z.object({
  action_items: z
    .array(
      z.object({
        text: z
          .string()
          .min(3)
          .max(240)
          .describe("Action item as a single imperative sentence."),
        timestamp_sec: z
          .number()
          .min(0)
          .describe(
            "Timestamp (in seconds) where this item was discussed. If unclear, use the start of the relevant section."
          ),
      })
    )
    .describe(
      "Action items spoken or committed to during the recording. Return an EMPTY array if the recording has no concrete next steps."
    ),
});

export type ActionItems = z.infer<typeof actionItemsSchema>;
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/schemas.ts
git commit -m "feat(ai): Zod schemas for title/summary, chapters, action items"
```

---

### Task 5: Unit tests for AI schemas

**Files:**
- Create: `tests/unit/ai-schemas.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from "vitest";
import {
  titleSummarySchema,
  chaptersSchema,
  actionItemsSchema,
} from "@/lib/ai/schemas";

describe("titleSummarySchema", () => {
  it("accepts a valid object", () => {
    const r = titleSummarySchema.safeParse({
      title: "Product demo walkthrough",
      summary: "A 5-minute tour of the new dashboard features, focused on the recording pipeline and AI outputs.",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty title", () => {
    const r = titleSummarySchema.safeParse({ title: "", summary: "anything long enough to pass the min" });
    expect(r.success).toBe(false);
  });

  it("rejects a too-short summary", () => {
    const r = titleSummarySchema.safeParse({ title: "Ok title", summary: "short" });
    expect(r.success).toBe(false);
  });
});

describe("chaptersSchema", () => {
  it("accepts an empty array (single-topic recording)", () => {
    const r = chaptersSchema.safeParse({ chapters: [] });
    expect(r.success).toBe(true);
  });

  it("accepts valid chapters", () => {
    const r = chaptersSchema.safeParse({
      chapters: [
        { start_sec: 0, title: "Intro" },
        { start_sec: 45.5, title: "Main demo" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative timestamps", () => {
    const r = chaptersSchema.safeParse({
      chapters: [{ start_sec: -1, title: "Oops" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("actionItemsSchema", () => {
  it("accepts an empty array", () => {
    const r = actionItemsSchema.safeParse({ action_items: [] });
    expect(r.success).toBe(true);
  });

  it("accepts valid items", () => {
    const r = actionItemsSchema.safeParse({
      action_items: [
        { text: "Ship the recording pipeline by Friday.", timestamp_sec: 120 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects too-short text", () => {
    const r = actionItemsSchema.safeParse({
      action_items: [{ text: "hi", timestamp_sec: 0 }],
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test
```
Expected: 25 (existing) + 9 (new) = 34 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/ai-schemas.test.ts
git commit -m "test(ai): Zod schema round-trip"
```

---

### Task 6: ai_outputs query module

**Files:**
- Create: `src/db/queries/ai-outputs.ts`

- [ ] **Step 1: Create the module**

```typescript
import { db } from "@/db";
import { aiOutputs, mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  TitleSummary,
  Chapters,
  ActionItems,
} from "@/lib/ai/schemas";

export type AiOutput = typeof aiOutputs.$inferSelect;

/**
 * Inserts a blank ai_outputs row for a recording. Called from the Deepgram
 * webhook right before the four processing jobs are enqueued. Each job
 * then performs a focused UPDATE on the column it owns.
 */
export async function insertBlankAiOutput(
  mediaObjectId: string,
  llmModel: string
): Promise<AiOutput> {
  const [row] = await db
    .insert(aiOutputs)
    .values({
      mediaObjectId,
      llmModel,
    })
    .returning();
  return row;
}

export async function getAiOutputByMedia(
  mediaObjectId: string
): Promise<AiOutput | null> {
  const [row] = await db
    .select()
    .from(aiOutputs)
    .where(eq(aiOutputs.mediaObjectId, mediaObjectId))
    .limit(1);
  return row ?? null;
}

export async function updateTitleSummary(
  mediaObjectId: string,
  data: TitleSummary
): Promise<void> {
  await db
    .update(aiOutputs)
    .set({
      titleSuggested: data.title,
      summary: data.summary,
    })
    .where(eq(aiOutputs.mediaObjectId, mediaObjectId));
}

export async function updateChapters(
  mediaObjectId: string,
  chapters: Chapters["chapters"]
): Promise<void> {
  await db
    .update(aiOutputs)
    .set({ chapters })
    .where(eq(aiOutputs.mediaObjectId, mediaObjectId));
}

export async function updateActionItems(
  mediaObjectId: string,
  actionItems: ActionItems["action_items"]
): Promise<void> {
  await db
    .update(aiOutputs)
    .set({ actionItems })
    .where(eq(aiOutputs.mediaObjectId, mediaObjectId));
}

/**
 * If every processing output is present for this recording, flip status
 * to 'ready'. Idempotent. Called at the end of each of the 4 processing
 * jobs — whichever finishes last is the one that flips status.
 */
export async function flipToReadyIfComplete(
  mediaObjectId: string
): Promise<void> {
  const ai = await getAiOutputByMedia(mediaObjectId);
  if (!ai) return;

  // Title/summary + chapters + action items are all required. Empty arrays
  // (for chapters/action_items) COUNT as complete — they're valid outputs
  // for short/single-topic recordings.
  const hasTitleSummary =
    ai.titleSuggested !== null && ai.summary !== null;
  const hasChapters = ai.chapters !== null;
  const hasActionItems = ai.actionItems !== null;

  const [media] = await db
    .select({
      status: mediaObjects.status,
      thumb: mediaObjects.compositeThumbnailKey,
    })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  if (!media) return;

  const hasThumb = media.thumb !== null;

  if (hasTitleSummary && hasChapters && hasActionItems && hasThumb) {
    await db
      .update(mediaObjects)
      .set({ status: "ready" })
      .where(eq(mediaObjects.id, mediaObjectId));
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/ai-outputs.ts
git commit -m "feat(db): ai_outputs query module with completion-check"
```

---

### Task 7: Title + summary job

**Files:**
- Create: `src/lib/queue/jobs/generate-title-summary.ts`

- [ ] **Step 1: Create the job**

```typescript
import { generateObject } from "ai";
import { getLlm } from "@/lib/ai/client";
import { titleSummarySchema } from "@/lib/ai/schemas";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import {
  updateTitleSummary,
  flipToReadyIfComplete,
} from "@/db/queries/ai-outputs";

export const TITLE_SUMMARY_JOB = "generate_title_summary";

export type TitleSummaryJobData = { mediaObjectId: string };

export async function runTitleSummaryJob(
  data: TitleSummaryJobData
): Promise<void> {
  const transcript = await getTranscriptByRecording(data.mediaObjectId);
  if (!transcript) {
    throw new Error(
      `[title-summary] transcript not found for ${data.mediaObjectId}`
    );
  }

  const text = transcript.fullText.trim();
  if (text.length === 0) {
    // Empty transcript — store a placeholder instead of calling the LLM.
    await updateTitleSummary(data.mediaObjectId, {
      title: "Untitled recording",
      summary: "This recording has no detected speech.",
    });
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  const { object } = await generateObject({
    model: getLlm(),
    schema: titleSummarySchema,
    schemaName: "TitleSummary",
    prompt: [
      "You write titles and summaries for screen-recorded videos from their transcripts.",
      "",
      "Rules:",
      "- Title: 3-12 words, sentence case, no quotes, no trailing period.",
      "- Summary: 2-3 sentences covering WHAT the recording is about, not how long it is.",
      "- Focus on the substantive content. Ignore filler (ums, false starts).",
      "- If the transcript is unclear or mostly silence, say so honestly.",
      "",
      "Transcript:",
      text,
    ].join("\n"),
  });

  await updateTitleSummary(data.mediaObjectId, object);
  await flipToReadyIfComplete(data.mediaObjectId);

  console.log(
    `[title-summary] completed for ${data.mediaObjectId}: "${object.title}"`
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/jobs/generate-title-summary.ts
git commit -m "feat(ai): title + summary job via generateObject"
```

---

### Task 8: Chapters job

**Files:**
- Create: `src/lib/queue/jobs/generate-chapters.ts`

- [ ] **Step 1: Create the job**

```typescript
import { generateObject } from "ai";
import { getLlm } from "@/lib/ai/client";
import { chaptersSchema } from "@/lib/ai/schemas";
import { getTranscriptByRecording, type WordTimestamp } from "@/db/queries/transcripts";
import {
  updateChapters,
  flipToReadyIfComplete,
} from "@/db/queries/ai-outputs";

export const CHAPTERS_JOB = "generate_chapters";

export type ChaptersJobData = { mediaObjectId: string };

/**
 * Serializes word timestamps in a compact "[HH:MM:SS] word word word" form
 * every ~10 seconds so the LLM has rough time markers without being
 * overwhelmed by individual word data.
 */
function buildTimedTranscript(words: WordTimestamp[]): string {
  if (words.length === 0) return "";
  const lines: string[] = [];
  let lineStart = words[0].start;
  let lineWords: string[] = [];
  for (const w of words) {
    if (w.start - lineStart >= 10 && lineWords.length > 0) {
      lines.push(`[${Math.floor(lineStart)}s] ${lineWords.join(" ")}`);
      lineStart = w.start;
      lineWords = [];
    }
    lineWords.push(w.word);
  }
  if (lineWords.length > 0) {
    lines.push(`[${Math.floor(lineStart)}s] ${lineWords.join(" ")}`);
  }
  return lines.join("\n");
}

export async function runChaptersJob(data: ChaptersJobData): Promise<void> {
  const transcript = await getTranscriptByRecording(data.mediaObjectId);
  if (!transcript) {
    throw new Error(`[chapters] transcript not found for ${data.mediaObjectId}`);
  }

  const words = transcript.wordTimestamps as WordTimestamp[];
  if (!Array.isArray(words) || words.length === 0) {
    await updateChapters(data.mediaObjectId, []);
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  // Heuristic: if the transcript is < 60s, no chapters.
  const durationSec = words[words.length - 1]?.end ?? 0;
  if (durationSec < 60) {
    await updateChapters(data.mediaObjectId, []);
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  const timed = buildTimedTranscript(words);
  const { object } = await generateObject({
    model: getLlm(),
    schema: chaptersSchema,
    schemaName: "Chapters",
    prompt: [
      "You write chapter markers for screen recordings from their time-stamped transcripts.",
      "",
      "Rules:",
      "- Return between 0 and 8 chapters.",
      "- The first chapter (if any) MUST start at 0.",
      "- Chapters must be strictly increasing in start_sec.",
      "- Each chapter title is 2-10 words, sentence case, no period.",
      "- Return an EMPTY array if the recording has no natural topic shifts.",
      "- Only pick chapter boundaries where the speaker clearly transitions.",
      "",
      `Recording duration: ${Math.ceil(durationSec)} seconds.`,
      "",
      "Timed transcript (seconds in brackets):",
      timed,
    ].join("\n"),
  });

  // Clamp any start_sec values to the actual duration, defensively.
  const clamped = object.chapters.map((c) => ({
    start_sec: Math.min(c.start_sec, durationSec),
    title: c.title,
  }));

  await updateChapters(data.mediaObjectId, clamped);
  await flipToReadyIfComplete(data.mediaObjectId);

  console.log(
    `[chapters] completed for ${data.mediaObjectId}: ${clamped.length} chapters`
  );
}

export { buildTimedTranscript };
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/jobs/generate-chapters.ts
git commit -m "feat(ai): chapters job with timed-transcript prompt"
```

---

### Task 9: Unit tests for chapter timing helper

**Files:**
- Create: `tests/unit/chapter-timing.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from "vitest";
import { buildTimedTranscript } from "@/lib/queue/jobs/generate-chapters";
import type { WordTimestamp } from "@/db/queries/transcripts";

describe("buildTimedTranscript", () => {
  it("returns empty string for empty input", () => {
    expect(buildTimedTranscript([])).toBe("");
  });

  it("groups words into ~10-second lines", () => {
    const words: WordTimestamp[] = [
      { word: "hello", start: 0, end: 0.5 },
      { word: "world", start: 0.6, end: 1.0 },
      { word: "and", start: 12.0, end: 12.2 },
      { word: "goodbye", start: 12.3, end: 12.8 },
    ];
    const out = buildTimedTranscript(words);
    expect(out).toContain("[0s] hello world");
    expect(out).toContain("[12s] and goodbye");
  });

  it("includes the final partial line", () => {
    const words: WordTimestamp[] = [
      { word: "only", start: 0, end: 0.5 },
      { word: "line", start: 1.0, end: 1.5 },
    ];
    const out = buildTimedTranscript(words);
    expect(out).toBe("[0s] only line");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test
```
Expected: 34 + 3 = 37 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/chapter-timing.test.ts
git commit -m "test(ai): chapter timing helper"
```

---

### Task 10: Action items job

**Files:**
- Create: `src/lib/queue/jobs/extract-action-items.ts`

- [ ] **Step 1: Create the job**

```typescript
import { generateObject } from "ai";
import { getLlm } from "@/lib/ai/client";
import { actionItemsSchema } from "@/lib/ai/schemas";
import {
  getTranscriptByRecording,
  type WordTimestamp,
} from "@/db/queries/transcripts";
import {
  updateActionItems,
  flipToReadyIfComplete,
} from "@/db/queries/ai-outputs";

export const ACTION_ITEMS_JOB = "extract_action_items";

export type ActionItemsJobData = { mediaObjectId: string };

export async function runActionItemsJob(
  data: ActionItemsJobData
): Promise<void> {
  const transcript = await getTranscriptByRecording(data.mediaObjectId);
  if (!transcript) {
    throw new Error(`[action-items] transcript not found for ${data.mediaObjectId}`);
  }

  const text = transcript.fullText.trim();
  if (text.length === 0) {
    await updateActionItems(data.mediaObjectId, []);
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  const words = transcript.wordTimestamps as WordTimestamp[];
  const durationSec =
    Array.isArray(words) && words.length > 0
      ? words[words.length - 1]?.end ?? 0
      : 0;

  const { object } = await generateObject({
    model: getLlm(),
    schema: actionItemsSchema,
    schemaName: "ActionItems",
    prompt: [
      "You extract concrete action items from screen-recording transcripts.",
      "",
      "Rules:",
      "- Include only items that represent a specific committed action or next step.",
      "- Phrase each as a single imperative sentence (e.g. 'Send Kate the updated mockups').",
      "- If the speaker says 'I'll do X', phrase as 'Do X' — drop the 'I'll'.",
      "- Skip vague ideas, hypotheticals, or casual remarks.",
      "- Return an EMPTY array if there are no concrete next steps.",
      "- Use approximate timestamps (round to the nearest second).",
      "",
      `Recording duration: ${Math.ceil(durationSec)} seconds.`,
      "",
      "Transcript:",
      text,
    ].join("\n"),
  });

  // Clamp timestamps defensively.
  const clamped = object.action_items.map((a) => ({
    text: a.text,
    timestamp_sec: Math.min(a.timestamp_sec, durationSec),
  }));

  await updateActionItems(data.mediaObjectId, clamped);
  await flipToReadyIfComplete(data.mediaObjectId);

  console.log(
    `[action-items] completed for ${data.mediaObjectId}: ${clamped.length} items`
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/jobs/extract-action-items.ts
git commit -m "feat(ai): action items job"
```

---

### Task 11: R2 bytes-upload helper

**Files:**
- Create: `src/lib/r2/upload-bytes.ts`

- [ ] **Step 1: Create the helper**

```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, r2BucketName } from "./client";

/**
 * Uploads a small in-memory payload to R2. For large streams, use multipart
 * (see multipart.ts). For thumbnails (~tens of KB), a single PutObject is
 * fine.
 */
export async function uploadBytes(
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: r2BucketName(),
      Key: key,
      Body: bytes,
      ContentType: contentType,
    })
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/r2/upload-bytes.ts
git commit -m "feat(r2): uploadBytes helper for small payloads"
```

---

### Task 12: Thumbnail job

**Files:**
- Create: `src/lib/queue/jobs/generate-thumbnail.ts`

- [ ] **Step 1: Create the job**

```typescript
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { presignGet } from "@/lib/r2/presigned-get";
import { uploadBytes } from "@/lib/r2/upload-bytes";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { flipToReadyIfComplete } from "@/db/queries/ai-outputs";

export const THUMBNAIL_JOB = "generate_thumbnail";

export type ThumbnailJobData = { mediaObjectId: string; compositeKey: string };

const ffmpegPath = ffmpegStatic as unknown as string;

/**
 * Extracts a JPG frame at the 1-second mark from the composite video using
 * ffmpeg reading directly from a signed R2 URL (HTTP range requests only —
 * no full download). Uploads the JPG to R2 and records the key on the
 * media_objects row.
 */
export async function runThumbnailJob(data: ThumbnailJobData): Promise<void> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not resolve an ffmpeg binary path");
  }

  const videoUrl = await presignGet(data.compositeKey);

  const jpg = await ffmpegExtractFrame(videoUrl, 1.0);
  const thumbKey = `${data.compositeKey.replace(/\/composite\.webm$/, "")}/thumbnail.jpg`;

  await uploadBytes(thumbKey, jpg, "image/jpeg");

  await db
    .update(mediaObjects)
    .set({ compositeThumbnailKey: thumbKey })
    .where(eq(mediaObjects.id, data.mediaObjectId));

  await flipToReadyIfComplete(data.mediaObjectId);

  console.log(
    `[thumbnail] saved ${thumbKey} (${jpg.byteLength} bytes) for ${data.mediaObjectId}`
  );
}

/**
 * Invokes ffmpeg to seek to `seekSec` in the remote URL and return a single
 * JPG-encoded frame as a Buffer. Uses -ss before -i for fast seek.
 */
function ffmpegExtractFrame(url: string, seekSec: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seekSec),
      "-i",
      url,
      "-frames:v",
      "1",
      "-q:v",
      "5", // reasonable JPEG quality, smaller file
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => errChunks.push(c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/jobs/generate-thumbnail.ts
git commit -m "feat(thumbnail): ffmpeg-static extracts JPG via HTTP range from R2"
```

---

### Task 13: Fan-out enqueue helper

**Files:**
- Create: `src/lib/queue/enqueue-processing.ts`

- [ ] **Step 1: Create the helper**

```typescript
import { getBoss } from "./boss";
import {
  TITLE_SUMMARY_JOB,
  type TitleSummaryJobData,
} from "./jobs/generate-title-summary";
import { CHAPTERS_JOB, type ChaptersJobData } from "./jobs/generate-chapters";
import {
  ACTION_ITEMS_JOB,
  type ActionItemsJobData,
} from "./jobs/extract-action-items";
import { THUMBNAIL_JOB, type ThumbnailJobData } from "./jobs/generate-thumbnail";

const COMMON_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 1800, // 30 minutes
};

export async function enqueueProcessingJobs(params: {
  mediaObjectId: string;
  compositeKey: string;
}): Promise<void> {
  const boss = await getBoss();
  const ts: TitleSummaryJobData = { mediaObjectId: params.mediaObjectId };
  const ch: ChaptersJobData = { mediaObjectId: params.mediaObjectId };
  const ai: ActionItemsJobData = { mediaObjectId: params.mediaObjectId };
  const th: ThumbnailJobData = {
    mediaObjectId: params.mediaObjectId,
    compositeKey: params.compositeKey,
  };
  await Promise.all([
    boss.send(TITLE_SUMMARY_JOB, ts, COMMON_OPTIONS),
    boss.send(CHAPTERS_JOB, ch, COMMON_OPTIONS),
    boss.send(ACTION_ITEMS_JOB, ai, COMMON_OPTIONS),
    boss.send(THUMBNAIL_JOB, th, COMMON_OPTIONS),
  ]);
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/enqueue-processing.ts
git commit -m "feat(queue): fan-out helper to enqueue all 4 processing jobs"
```

---

### Task 14: Register new queues + workers in boss.ts

**Files:**
- Modify: `src/lib/queue/boss.ts`

- [ ] **Step 1: Update the init to register the 4 new queues**

Replace `src/lib/queue/boss.ts` with:

```typescript
import { PgBoss } from "pg-boss";
import { TRANSCRIBE_JOB, runTranscribeJob, type TranscribeJobData } from "./jobs/transcribe";
import {
  TITLE_SUMMARY_JOB,
  runTitleSummaryJob,
  type TitleSummaryJobData,
} from "./jobs/generate-title-summary";
import {
  CHAPTERS_JOB,
  runChaptersJob,
  type ChaptersJobData,
} from "./jobs/generate-chapters";
import {
  ACTION_ITEMS_JOB,
  runActionItemsJob,
  type ActionItemsJobData,
} from "./jobs/extract-action-items";
import {
  THUMBNAIL_JOB,
  runThumbnailJob,
  type ThumbnailJobData,
} from "./jobs/generate-thumbnail";

let cached: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function init(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const boss = new PgBoss({
    connectionString,
    max: 8,
  });

  boss.on("error", (err: unknown) => {
    console.error("[pg-boss] error:", err);
  });

  await boss.start();

  // pg-boss v10+ requires queues to exist before send()/work() — no auto-create.
  await boss.createQueue(TRANSCRIBE_JOB);
  await boss.createQueue(TITLE_SUMMARY_JOB);
  await boss.createQueue(CHAPTERS_JOB);
  await boss.createQueue(ACTION_ITEMS_JOB);
  await boss.createQueue(THUMBNAIL_JOB);

  await boss.work<TranscribeJobData>(TRANSCRIBE_JOB, async (jobs) => {
    for (const job of jobs) await runTranscribeJob(job.data);
  });
  await boss.work<TitleSummaryJobData>(TITLE_SUMMARY_JOB, async (jobs) => {
    for (const job of jobs) await runTitleSummaryJob(job.data);
  });
  await boss.work<ChaptersJobData>(CHAPTERS_JOB, async (jobs) => {
    for (const job of jobs) await runChaptersJob(job.data);
  });
  await boss.work<ActionItemsJobData>(ACTION_ITEMS_JOB, async (jobs) => {
    for (const job of jobs) await runActionItemsJob(job.data);
  });
  await boss.work<ThumbnailJobData>(THUMBNAIL_JOB, async (jobs) => {
    for (const job of jobs) await runThumbnailJob(job.data);
  });

  console.log("[pg-boss] started and workers registered (5 queues)");
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
    expireInSeconds: 3600,
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queue/boss.ts
git commit -m "feat(queue): register 4 new AI/thumbnail queues + workers"
```

---

### Task 15: Update Deepgram webhook to enqueue processing jobs

**Files:**
- Modify: `src/app/api/webhooks/deepgram/[recordingId]/[sig]/route.ts`

- [ ] **Step 1: Replace the route**

```typescript
import { NextResponse } from "next/server";
import { verifyRecordingSignature } from "@/lib/deepgram/callback-signature";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { insertTranscript, type WordTimestamp } from "@/db/queries/transcripts";
import { insertBlankAiOutput } from "@/db/queries/ai-outputs";
import { enqueueProcessingJobs } from "@/lib/queue/enqueue-processing";

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
  { params }: { params: Promise<{ recordingId: string; sig: string }> }
) {
  const { recordingId, sig } = await params;

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

  // Fetch the recording to get its composite key (needed for thumbnail job)
  // and ensure it exists before fanning out.
  const [rec] = await db
    .select({
      id: mediaObjects.id,
      r2CompositeKey: mediaObjects.r2CompositeKey,
    })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, recordingId))
    .limit(1);

  if (!rec?.r2CompositeKey) {
    console.error(
      `[webhook/deepgram] recording ${recordingId} has no composite key; skipping processing`
    );
    return NextResponse.json({ ok: true });
  }

  // Pre-create the ai_outputs row so the 4 UPDATE-based jobs have a target.
  const llmModel = process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  await insertBlankAiOutput(recordingId, llmModel);

  // Flip to 'processing' and fan out the 4 jobs. The last job to finish
  // will call flipToReadyIfComplete and move status to 'ready'.
  await db
    .update(mediaObjects)
    .set({ status: "processing" })
    .where(eq(mediaObjects.id, recordingId));

  try {
    await enqueueProcessingJobs({
      mediaObjectId: recordingId,
      compositeKey: rec.r2CompositeKey,
    });
  } catch (err) {
    console.error(
      `[webhook/deepgram] failed to enqueue processing jobs for ${recordingId}:`,
      err
    );
  }

  console.log(
    `[webhook/deepgram] transcript saved, processing jobs enqueued for ${recordingId} (${wordTimestamps.length} words)`
  );

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/webhooks/deepgram/[recordingId]/[sig]/route.ts"
git commit -m "feat(webhook): insert ai_outputs row + enqueue 4 processing jobs after transcript"
```

---

### Task 16: Extend recordings queries with ai_outputs

**Files:**
- Modify: `src/db/queries/recordings.ts`

- [ ] **Step 1: Extend the query module**

Replace the file:

```typescript
import { db } from "@/db";
import { mediaObjects, brandProfiles, aiOutputs } from "@/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export type Recording = typeof mediaObjects.$inferSelect;

export type RecordingWithBrand = Recording & {
  brand: { id: string; name: string; accentColor: string } | null;
  aiTitle: string | null;
  aiSummary: string | null;
  aiChapters: Array<{ start_sec: number; title: string }> | null;
  aiActionItems: Array<{ text: string; timestamp_sec: number }> | null;
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
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(
      and(eq(mediaObjects.ownerId, ownerId), isNull(mediaObjects.deletedAt))
    )
    .orderBy(desc(mediaObjects.createdAt));

  return rows.map((r) => ({
    ...r.rec,
    brand: r.brandId
      ? { id: r.brandId, name: r.brandName!, accentColor: r.brandAccent! }
      : null,
    aiTitle: r.aiTitle,
    aiSummary: r.aiSummary,
    aiChapters: r.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: r.aiActionItems as RecordingWithBrand["aiActionItems"],
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
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(and(eq(mediaObjects.slug, slug), isNull(mediaObjects.deletedAt)))
    .limit(1);

  if (!row) return null;
  return {
    ...row.rec,
    brand: row.brandId
      ? { id: row.brandId, name: row.brandName!, accentColor: row.brandAccent! }
      : null,
    aiTitle: row.aiTitle,
    aiSummary: row.aiSummary,
    aiChapters: row.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: row.aiActionItems as RecordingWithBrand["aiActionItems"],
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

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/recordings.ts
git commit -m "feat(db): listRecordings + getRecordingBySlug join ai_outputs"
```

---

### Task 17: Update recording card to use AI title + thumbnail

**Files:**
- Modify: `src/components/dashboard/recording-card.tsx`

- [ ] **Step 1: Add optional thumbnailUrl prop + fallback chain for title**

Replace the file:

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

export function RecordingCard({
  rec,
  thumbnailUrl,
}: {
  rec: RecordingWithBrand;
  thumbnailUrl: string | null;
}) {
  const displayTitle =
    rec.title || rec.aiTitle || "Untitled recording";
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
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          className="aspect-video w-full rounded object-cover"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded bg-white/5 text-xs opacity-40">
          {rec.status === "ready" ? "No thumbnail" : "Generating…"}
        </div>
      )}
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-medium">{displayTitle}</h3>
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

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: FAIL — RecordingList now has to pass `thumbnailUrl`. Fixed in Task 18.

- [ ] **Step 3: Stage but don't commit** — commit after Task 18 so history remains typecheck-clean.

---

### Task 18: Update RecordingList + HomePage to resolve signed thumbnail URLs

**Files:**
- Modify: `src/components/dashboard/recording-list.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update the list component to accept a thumbnail map**

Replace `src/components/dashboard/recording-list.tsx`:

```typescript
import Link from "next/link";
import type { RecordingWithBrand } from "@/db/queries/recordings";
import { RecordingCard } from "./recording-card";

export function RecordingList({
  recordings,
  thumbnailUrls,
}: {
  recordings: RecordingWithBrand[];
  thumbnailUrls: Record<string, string>;
}) {
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
          <RecordingCard
            rec={r}
            thumbnailUrl={thumbnailUrls[r.id] ?? null}
          />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Update the home page to resolve signed URLs**

Replace `src/app/page.tsx`:

```typescript
import { requireAuth } from "@/lib/require-auth";
import { listRecordings } from "@/db/queries/recordings";
import { presignGet } from "@/lib/r2/presigned-get";
import { TopNav } from "@/components/nav/top-nav";
import { RecordingList } from "@/components/dashboard/recording-list";
import Link from "next/link";

export default async function HomePage() {
  const user = await requireAuth();
  const recordings = await listRecordings(user.id);

  // Resolve a signed GET URL for each recording's thumbnail (if any).
  const thumbnailUrls: Record<string, string> = {};
  await Promise.all(
    recordings.map(async (r) => {
      if (r.compositeThumbnailKey) {
        thumbnailUrls[r.id] = await presignGet(r.compositeThumbnailKey);
      }
    })
  );

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
        <div class="mt-6">
          <RecordingList recordings={recordings} thumbnailUrls={thumbnailUrls} />
        </div>
      </div>
    </>
  );
}
```

Correction to the JSX: replace `class=` with `className=` (TS JSX requires the latter):

```typescript
        <div className="mt-6">
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 4: Commit Tasks 17 + 18 together**

```bash
git add src/components/dashboard/recording-card.tsx src/components/dashboard/recording-list.tsx src/app/page.tsx
git commit -m "feat(dashboard): render AI-generated titles + signed thumbnails on cards"
```

---

### Task 19: Render AI outputs on share page

**Files:**
- Modify: `src/app/v/[slug]/page.tsx`

- [ ] **Step 1: Replace the page**

```typescript
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { presignGet } from "@/lib/r2/presigned-get";
import { CopyLinkButton } from "@/components/share/copy-link-button";
import Link from "next/link";

function formatTs(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

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

  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";

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
        <h1 className="text-2xl font-semibold">{displayTitle}</h1>
        <p className="mt-1 text-sm opacity-60">
          {rec.status === "ready" ? "Ready" : `Status: ${rec.status}`}
        </p>

        {rec.aiSummary && (
          <p className="mt-4 text-sm leading-relaxed opacity-80">{rec.aiSummary}</p>
        )}

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

        {isOwner && rec.aiChapters && rec.aiChapters.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-medium">Chapters</h2>
            <ul className="mt-2 space-y-1">
              {rec.aiChapters.map((c, i) => (
                <li key={i} className="flex items-baseline gap-3 text-sm">
                  <code className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs opacity-80">
                    {formatTs(c.start_sec)}
                  </code>
                  <span>{c.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isOwner && rec.aiActionItems && rec.aiActionItems.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-medium">Action items</h2>
            <ul className="mt-2 space-y-2">
              {rec.aiActionItems.map((a, i) => (
                <li key={i} className="flex items-baseline gap-3 text-sm">
                  <code className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs opacity-80">
                    {formatTs(a.timestamp_sec)}
                  </code>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
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

        {isOwner && (rec.status === "transcribing" || rec.status === "processing") && (
          <p className="mt-6 text-xs opacity-60">
            {rec.status === "transcribing"
              ? "Transcription in progress — refresh in ~30 seconds."
              : "AI outputs generating — refresh in ~15-30 seconds."}
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

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/v/[slug]/page.tsx"
git commit -m "feat(share): render AI title/summary/chapters/action items on share page"
```

---

### Task 20: Mark webpack externals for ffmpeg-static

**Files:**
- Modify: `next.config.ts`

`ffmpeg-static` ships a binary that Next.js's webpack pass may try to bundle. Externalizing it is the safe move — same pattern as pg-boss.

- [ ] **Step 1: Add to the external list**

Replace `next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  serverExternalPackages: [
    "pg-boss",
    "pg",
    "pg-native",
    "ffmpeg-static",
  ],
};

export default nextConfig;
```

- [ ] **Step 2: Typecheck + build**

```bash
npm run typecheck
set -a && source .env.local && set +a
rm -rf .next
npm run build
```
Expected: both exit 0; build output lists new /api/webhooks route unchanged + all four worker-targeted paths remain server-rendered.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "fix(build): mark ffmpeg-static external so standalone output copies the binary"
```

---

### Task 21: Dockerfile — ensure ffmpeg-static binary ships in runtime stage

**Files:**
- Modify: `Dockerfile`

`serverExternalPackages` keeps `ffmpeg-static` out of webpack but Next.js's standalone output only copies packages it can statically trace. The binary (`node_modules/ffmpeg-static/ffmpeg`) must be explicitly copied into the runtime image, similar to how we copy `drizzle/` and `scripts/migrate.cjs`.

- [ ] **Step 1: Replace the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

############
# Base
############
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat curl bash gnupg
WORKDIR /app

############
# Deps
############
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

############
# Build
############
FROM base AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Bundle migrate.ts into self-contained CJS so runtime needs no tsx/esbuild.
RUN npx esbuild scripts/migrate.ts \
      --bundle \
      --platform=node \
      --format=cjs \
      --target=node22 \
      --outfile=scripts/migrate.cjs

############
# Runtime
############
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install Doppler CLI
RUN curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh

# Copy standalone Next.js output (includes its own node_modules for what it imports)
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Migration artifacts (SQL files + bundled runner)
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.cjs ./scripts/migrate.cjs

# Externalised server packages — Next.js standalone doesn't copy these
# because they're marked as serverExternalPackages, so we copy them
# explicitly here.
COPY --from=build /app/node_modules/pg-boss ./node_modules/pg-boss
COPY --from=build /app/node_modules/pg ./node_modules/pg
COPY --from=build /app/node_modules/ffmpeg-static ./node_modules/ffmpeg-static
# pg-boss transitive deps (narrow list; expand if runtime import errors surface)
COPY --from=build /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=build /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=build /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=build /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=build /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=build /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=build /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=build /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=build /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=build /app/node_modules/split2 ./node_modules/split2
COPY --from=build /app/node_modules/cron-parser ./node_modules/cron-parser
COPY --from=build /app/node_modules/serialize-error ./node_modules/serialize-error
COPY --from=build /app/node_modules/uuid ./node_modules/uuid

EXPOSE 3000

ENTRYPOINT ["doppler", "run", "--"]
CMD ["sh", "-c", "node ./scripts/migrate.cjs && node ./server.js"]
```

- [ ] **Step 2: Smoke-build locally if Docker Desktop is running**

If `which docker` succeeds AND Docker Desktop is running:

```bash
set -a && source .env.local && set +a
docker build -t loom-clone:m6 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_APP_URL="https://loom.dissonance.cloud" \
  . 2>&1 | tail -20
```

Expected: build completes without module-not-found errors. If a transitive pg-boss dep is missing, ffmpeg-static will likely work but pg-boss will fail on `require('missing-dep')` at runtime — add it to the COPY list and rebuild.

If Docker isn't running locally, skip this step — Coolify will build and fail loudly if anything's missing.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "fix(docker): explicitly copy ffmpeg-static + pg-boss transitive deps to runtime stage"
```

---

### Task 22: Push + smoke test on prod

**Files:** none

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Wait for Coolify deploy**

Watch https://coolify.dissonance.cloud for the new container to reach Running. First boot should log:

```
[pg-boss] started and workers registered (5 queues)
```

If pg-boss complains about a missing module at runtime, add it to the Dockerfile COPY list (Task 21 Step 1) and push again.

- [ ] **Step 3: Record a 20-second test clip with speech**

Visit https://loom.dissonance.cloud/record, record a 20-second clip talking through a couple of topics clearly, stop.

- [ ] **Step 4: Watch the status progression**

Refresh `/v/:slug` every 10-15 seconds:
1. First: `Status: transcribing` (~10-30s)
2. Then: `Status: processing` + transcript appears (~5-15s per LLM job, in parallel)
3. Eventually: `Status: ready` with title, summary, (maybe) chapters, (maybe) action items, and thumbnail on the dashboard card

- [ ] **Step 5: Verify DB state**

```bash
set -a && source .env.local && set +a
node -e "
import('postgres').then(async ({default: postgres}) => {
  const sql = postgres(process.env.DATABASE_URL, {max:1,idle_timeout:5});
  const rows = await sql\`
    SELECT m.slug, m.status, m.composite_thumbnail_key IS NOT NULL AS has_thumb,
           a.title_suggested, left(a.summary, 60) AS summary_preview,
           jsonb_array_length(coalesce(a.chapters, '[]'::jsonb)) AS ch_count,
           jsonb_array_length(coalesce(a.action_items, '[]'::jsonb)) AS ai_count
    FROM media_objects m LEFT JOIN ai_outputs a ON a.media_object_id = m.id
    ORDER BY m.created_at DESC LIMIT 3
  \`;
  console.log(rows);
  await sql.end();
});
"
```

Expected for the most recent: status='ready', has_thumb=true, title_suggested set, summary_preview set, ch_count ≥ 0, ai_count ≥ 0.

- [ ] **Step 6: Mark M6 shipped**

```bash
# Update ROADMAP.md — change M6 line to ✅ shipped and M7 to 🔄 next
# Update CLAUDE.md — append M6 bullet

git add ROADMAP.md CLAUDE.md
git commit -m "docs: mark M6 shipped"
git push
```

---

## Milestone 6 Complete

You should have:

- AI-generated title, summary, chapters, and action items populating automatically after transcription
- JPG thumbnails on dashboard cards (ffmpeg extracted from R2 via range reads)
- Status flow: `uploading → transcribing → processing → ready`
- 5 pg-boss queues + workers live (transcribe + 4 processing)
- 37 Vitest tests passing (25 existing + 12 new: 9 schema + 3 chapter timing)
- 6 Playwright tests passing (unchanged)

Re-invoke `/superpowers:writing-plans` with "M7: Viewer page" when ready.

---

## Self-Review

**Spec coverage (M6 slice):**

- Title + summary generation via Claude → Task 7 ✓
- Chapter generation with allowed empty-array case → Task 8 ✓
- Action items with empty-array case → Task 10 ✓
- Thumbnail at 1-second mark via `ffmpeg-static` → Task 12 ✓
- LLM provider abstraction via Vercel AI SDK → Task 3, env-driven model ID → Task 1 step 2 ✓
- Structured output with Zod schemas (not brittle JSON parsing) → Tasks 4, 5 ✓
- Status `processing` between `transcribing` and `ready` → Task 15 ✓
- Each job runs in parallel via pg-boss fan-out → Task 13 ✓
- Last-one-wins `ready` flip via column-completeness check → Task 6 (`flipToReadyIfComplete`) ✓
- Anthropic API key separate from Max subscription → Task 1 step 1 note ✓

**Deferred to later milestones (correctly, per spec):**

- AI Q&A chat on a recording — future milestone
- Viewer UI with proper chapters on seek bar — M7
- Per-word transcript click-to-seek — M7

**Placeholder scan:** No TBD / TODO / "similar to Task N". Every step has full code or explicit commands.

**Type/name consistency:**

- `TitleSummary`, `Chapters`, `ActionItems` types exported from `schemas.ts` (Task 4), consumed in `ai-outputs.ts` (Task 6), job handlers (Tasks 7, 8, 10). All match. ✓
- Queue names: `TRANSCRIBE_JOB` (existing M5), `TITLE_SUMMARY_JOB`, `CHAPTERS_JOB`, `ACTION_ITEMS_JOB`, `THUMBNAIL_JOB` — each declared once in their respective job files, imported consistently in `boss.ts` (Task 14) and `enqueue-processing.ts` (Task 13). ✓
- `runTitleSummaryJob`, `runChaptersJob`, `runActionItemsJob`, `runThumbnailJob` — each job's data type matches what `enqueue-processing.ts` sends. ✓
- `flipToReadyIfComplete` called at the end of every job's happy path — Tasks 7, 8, 10, 12 all invoke. ✓
- `RecordingWithBrand` extended with `aiTitle / aiSummary / aiChapters / aiActionItems` — consumed by Task 17 (card), Task 19 (share page). ✓
- `getRecordingBySlug` return type and `listRecordings` return type unified. ✓
- `insertBlankAiOutput` signature matches webhook caller (Task 15). ✓

**One intentional footgun called out in the plan:** Task 17 alone breaks typecheck (card's `thumbnailUrl` prop not yet passed). Task 18 fixes and both commit together — same pattern as M3's Task 14+15.

**One explicitly-acknowledged risk:** the transitive-deps COPY list in the Dockerfile (Task 21) is guesswork based on what pg-boss typically imports. If a transitive dep is missing at runtime, the container will fail with `Cannot find module 'X'` — the plan says to add it and push again. Not a blocker, just requires iteration if it surfaces.
