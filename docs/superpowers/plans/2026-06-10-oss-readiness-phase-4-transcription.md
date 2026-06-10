# OSS Readiness Phase 4 — Pluggable Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `TRANSCRIBE_PROVIDER` is finally read. `deepgram` (the default, including when the var is unset or empty) keeps the existing async webhook flow with zero behavioral change — same Deepgram request parameters, same callback signing, same retry options. `openai-whisper` transcribes synchronously inside the `transcribe` pg-boss job: ffmpeg extracts mono audio from the stored media (video composite or audio track), the file is multipart-POSTed to OpenAI's `/v1/audio/transcriptions` with `response_format=verbose_json`, the response is normalized to the repo's transcript shape, and then the **same** persist + AI-job fan-out the Deepgram webhook runs executes in-process. No public callback URL is required — this unlocks localhost/LAN-only self-hosting with no ngrok/tunnel. Audio over OpenAI's 25MB cap fails the recording with a clear `failure_reason` (Phase 3 column) suggesting Deepgram for long recordings. Env contract and doctor validate the provider choice, including unknown values.

**Architecture:** The webhook's post-transcript pipeline (media lookup + granola gate, dictionary-variant rewrite, `insertTranscript`, embedding enqueue, audio-ready flip / blank `ai_outputs` + processing flip + `enqueueAiJobs`) is extracted **verbatim** into `persistTranscriptAndFanOut()` in `src/lib/transcription/persist.ts`; the webhook and the whisper path both call it, so downstream behavior (title/summary/chapters/action-items, folder + speaker suggestions, embeddings, `flipToReadyIfComplete`) is provider-independent by construction — including the Phase 3 retry route, which re-enqueues the same `transcribe` job and therefore picks up the provider switch for free. Provider dispatch is the spec's minimal interface — `submitTranscription(input) → {mode:'callback'} | {mode:'sync', result} | {mode:'failed', failureReason}` — implemented as a plain switch in `src/lib/transcription/submit.ts` (two providers = a switch, not a registry). The `NEXT_PUBLIC_APP_URL` requirement moves *inside* the deepgram branch: that is the precise mechanism by which whisper removes the public-URL requirement.

Three deliberate normalization decisions, defined explicitly:
1. **Word timeline from segments, not from whisper word timestamps.** `verbose_json` word entries (`{word,start,end}`) strip punctuation, and `groupWordsIntoParagraphs` (`src/lib/viewer/paragraphs.ts`) renders the transcript panel directly from the word array (`punctuated_word ?? word` — Deepgram path stores punctuated tokens in `word`). So we tokenize each segment's punctuated `text` and linearly interpolate timings across the segment's `[start,end]`. Degradation: seek precision inside a segment (~5–10s) is interpolated rather than exact; paragraph grouping, SRT export, chapters, and dictionary rewrite all keep working. Punctuated readable transcript > millisecond-exact unpunctuated one.
2. **No diarization: every whisper word gets `speaker: 0`.** The transcript panel renders a single speaker; `suggest_speakers` no-ops gracefully by design (its Path-B gate requires `speaker count == attendees + 1`, which a single-speaker transcript never satisfies — verified in `src/lib/queue/jobs/suggest-speakers.ts`). The granola `multichannel` stereo file (mic-L/system-R) is downmixed to mono by the ffmpeg extract step; source separation is lost and documented.
3. **25MB = reject, not chunk (v1).** ffmpeg re-encodes to 16kHz mono AAC @56kbps first (so a 200MB screen recording's *video* track never counts against the cap — ~25MB ≈ ~60 minutes of audio); if the *extracted audio* still exceeds 25MB, `setRecordingFailed()` writes a reason naming the limit and suggesting `TRANSCRIBE_PROVIDER=deepgram`. The owner Retry button (Phase 3) remains available after switching providers.

Out of scope, stated where users will look: the **live** in-meeting transcription drawer (Granola) uses Deepgram live tokens (`src/app/api/transcribe/live-token/route.ts`) regardless of `TRANSCRIBE_PROVIDER` — whisper covers batch transcription only. Local whisper.cpp is a documented future provider behind the same interface.

**Tech stack:** Next.js 15.5, pg-boss 12.16 (job options unchanged: retryLimit 3, backoff), Node 20 native `fetch`/`FormData`/`Blob` (same pattern as `src/lib/embeddings/openai.ts` — no OpenAI SDK dependency), ffmpeg via `spawn` reading the presigned URL directly (established pattern in `src/lib/queue/jobs/mix-audio.ts`; ffmpeg is in the Docker image via `apk add ffmpeg`), Drizzle, Vitest (`tests/unit`, `@/` alias from `vitest.config.ts`), strict TS.

**Spec:** `docs/superpowers/specs/2026-06-09-open-source-readiness-design.md` — Phase 4 (plus "Testing strategy": *transcription provider dispatch + Whisper response normalization*).

**OpenAI API facts the implementation relies on** (verify against live docs if anything 400s unexpectedly): `POST https://api.openai.com/v1/audio/transcriptions`, multipart fields `file`, `model`, `language` (ISO-639-1), `prompt`, `response_format`, `timestamp_granularities[]`. `verbose_json` + `timestamp_granularities` are **whisper-1 only** (`gpt-4o-transcribe`/`-mini` support only `json`/`text` — no timestamps), so the default model is `whisper-1` with an `OPENAI_TRANSCRIBE_MODEL` escape hatch documented as "must support verbose_json". Upload cap 25MB. `verbose_json` returns `{task, language, duration, text, segments:[{id, seek, start, end, text, tokens, avg_logprob, no_speech_prob, …}]}` where `language` is a lowercase English *name* ("english"), hence the name→ISO map.

**⚠️ Working-tree warning:** The tree was clean at planning time (`git status --short` empty, HEAD `56d15cd`), but re-check before starting. NEVER `git add -A` or `git add .` — stage only the files named in each task's commit step.

**⚠️ Prod deploys on every push to `main` (Coolify + Doppler).** Doppler prod does not set `TRANSCRIBE_PROVIDER` (or sets `deepgram`), so every task here is deepgram-default-invariant — but Task 1 (webhook refactor) and Task 3 (job rewiring) touch the live transcription path. Before *each* push: `npm run typecheck && npm run test && npm run lint && npm run build`, all green. After pushing Task 1 and Task 3, record something short on the prod instance (or wait for Ian's next recording) and confirm it reaches `ready` with a transcript.

---

### Task 1: Extract the shared persist + fan-out pipeline from the Deepgram webhook

**Files:**
- Create: `src/lib/transcription/types.ts`
- Create: `src/lib/transcription/persist.ts`
- Modify: `src/app/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]/route.ts`

This is a verbatim-move refactor of webhook lines 79–161 (media lookup → dictionary rewrite → `insertTranscript` → embedding enqueue → audio-ready / blank-ai-output + processing + `enqueueAiJobs`). No behavior change; no new tests (it is DB/queue wiring, which this repo's unit suite deliberately doesn't mock) — verification is typecheck + full suite + a line-by-line diff against the original.

- [ ] **Step 1: Create `src/lib/transcription/types.ts`** (pure, zero imports — Task 2's pure modules import from here so unit tests never touch `@/db`):

```typescript
/**
 * Provider-agnostic transcript shape. Structurally identical to
 * WordTimestamp in src/db/queries/transcripts.ts — duplicated here (5
 * lines) so pure normalization modules and their unit tests never import
 * a module that constructs a db client.
 */
export type TranscriptWord = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
};

export type NormalizedTranscript = {
  fullText: string;
  language: string;
  wordTimestamps: TranscriptWord[];
};
```

- [ ] **Step 2: Create `src/lib/transcription/persist.ts`**:

```typescript
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { insertTranscript } from "@/db/queries/transcripts";
import { insertBlankAiOutput } from "@/db/queries/ai-outputs";
import { enqueueAiJobs } from "@/lib/queue/enqueue-processing";
import { enqueueTranscriptEmbedding } from "@/lib/queue/boss";
import { enableGranola } from "@/lib/feature-flags";
import { listDictionaryTerms } from "@/db/queries/dictionary-terms";
import {
  buildVariantReplacementMap,
  collapseDictionaryVariants,
} from "@/lib/dictionary/transcript-rewrite";
import type { NormalizedTranscript } from "./types";

export type PersistTranscriptResult =
  | { kind: "not_found" }
  | { kind: "audio_ready"; wordCount: number }
  | { kind: "video_processing"; wordCount: number };

/**
 * Everything that must happen after ANY provider produces a transcript:
 * dictionary-variant rewrite, transcript upsert, embedding enqueue, and
 * the status flip — 'ready' for audio notes, or blank ai_outputs +
 * 'processing' + the 3-job AI fan-out for video. Extracted verbatim from
 * the Deepgram webhook so the synchronous openai-whisper path runs the
 * identical downstream pipeline.
 */
export async function persistTranscriptAndFanOut(params: {
  mediaObjectId: string;
  provider: string;
  providerRequestId: string | null;
  transcript: NormalizedTranscript;
}): Promise<PersistTranscriptResult> {
  const { mediaObjectId, provider, providerRequestId, transcript } = params;

  const [media] = await db
    .select({ type: mediaObjects.type, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  if (!media) return { kind: "not_found" };
  if (media.type === "audio" && !enableGranola()) return { kind: "not_found" };

  const replacements = buildVariantReplacementMap(
    await listDictionaryTerms(media.ownerId)
  );
  const rewritten = collapseDictionaryVariants(
    transcript.fullText,
    transcript.wordTimestamps,
    replacements
  );

  await insertTranscript({
    mediaObjectId,
    deepgramRequestId: provider === "deepgram" ? providerRequestId : null,
    provider,
    providerRequestId,
    language: transcript.language,
    fullText: rewritten.fullText,
    wordTimestamps: rewritten.words,
  });

  if (enableGranola()) {
    try {
      await enqueueTranscriptEmbedding({ mediaObjectId });
    } catch (err) {
      console.error(
        `[transcript] failed to enqueue transcript embedding for ${mediaObjectId}:`,
        err
      );
    }
  }

  if (media.type === "audio") {
    await db
      .update(mediaObjects)
      .set({ status: "ready", failureReason: null, updatedAt: sql`now()` })
      .where(eq(mediaObjects.id, mediaObjectId));
    return { kind: "audio_ready", wordCount: rewritten.words.length };
  }

  // Pre-create the ai_outputs row so the 3 UPDATE-based jobs have a target.
  const llmModel =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  await insertBlankAiOutput(mediaObjectId, llmModel);

  // Flip to 'processing' and fan out the 3 transcript-dependent AI jobs.
  // Thumbnail + preview-sprite were already enqueued at upload-complete
  // time (they don't need the transcript). The last job to finish — AI
  // or thumbnail — calls flipToReadyIfComplete and moves status to 'ready'.
  await db
    .update(mediaObjects)
    .set({ status: "processing", updatedAt: sql`now()` })
    .where(eq(mediaObjects.id, mediaObjectId));

  try {
    await enqueueAiJobs({ mediaObjectId });
  } catch (err) {
    console.error(
      `[transcript] failed to enqueue AI jobs for ${mediaObjectId}:`,
      err
    );
  }

  return { kind: "video_processing", wordCount: rewritten.words.length };
}
```

⚠️ Fidelity checklist against the current webhook (these are the load-bearing details — diff them by eye): `insertTranscript` receives the **rewritten** text/words; the audio flip sets `failureReason: null` but the processing flip does **not** (retry route owns that clear); `insertBlankAiOutput` happens **before** the processing flip; embedding enqueue and AI-job enqueue are both try/caught (never fail the caller); the granola gate returns not_found for audio when `enableGranola()` is false.

- [ ] **Step 3: Rewrite the webhook to call it.** Replace the body of `src/app/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]/route.ts` — keep the `DeepgramWord/Alternative/Channel/CallbackBody` types and `parseDeepgramTranscript` exactly as they are; the route becomes:

```typescript
import { NextResponse } from "next/server";
import { verifyAndConsumeCallbackToken } from "@/lib/deepgram/callback-signature";
import type { WordTimestamp } from "@/db/queries/transcripts";
import { persistTranscriptAndFanOut } from "@/lib/transcription/persist";
import {
  buildSegmentsFromWords,
  mergeSourceTranscriptSegments,
  sourceForDeepgramChannel,
  speakerForTranscriptSource,
  type SourceTranscriptWord,
} from "@/lib/transcript/source-merge";

// ... DeepgramWord, DeepgramAlternative, DeepgramChannel,
//     DeepgramCallbackBody type declarations — UNCHANGED ...

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ recordingId: string; nonce: string; sig: string }>;
  }
) {
  const { recordingId, nonce, sig } = await params;

  const ok = await verifyAndConsumeCallbackToken({ recordingId, nonce, sig });
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = (await request.json()) as DeepgramCallbackBody;
  const channels = body.results?.channels ?? [];
  const parsedTranscript = parseDeepgramTranscript(channels);
  const requestId = body.metadata?.request_id ?? null;

  const result = await persistTranscriptAndFanOut({
    mediaObjectId: recordingId,
    provider: "deepgram",
    providerRequestId: requestId,
    transcript: parsedTranscript,
  });

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  console.log(
    result.kind === "audio_ready"
      ? `[webhook/deepgram] audio transcript saved for ${recordingId} (${result.wordCount} words)`
      : `[webhook/deepgram] transcript saved, processing jobs enqueued for ${recordingId} (${result.wordCount} words)`
  );
  return NextResponse.json({ ok: true });
}

// ... parseDeepgramTranscript — UNCHANGED ...
```

Delete the now-unused imports (`db`, `mediaObjects`, `eq`, `sql`, `insertTranscript`, `insertBlankAiOutput`, `enqueueAiJobs`, `enqueueTranscriptEmbedding`, `enableGranola`, `listDictionaryTerms`, `buildVariantReplacementMap`, `collapseDictionaryVariants`). `parseDeepgramTranscript`'s return type (`{fullText, language, wordTimestamps: WordTimestamp[]}`) is structurally identical to `NormalizedTranscript` — no cast needed.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: all green (the full unit suite — 250+ tests — passes untouched).
Then: `git diff` and confirm by eye that every statement removed from the webhook reappears in `persist.ts` with identical semantics per the Step 2 fidelity checklist.

- [ ] **Step 5: Commit and push**

```bash
git add src/lib/transcription/types.ts src/lib/transcription/persist.ts "src/app/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]/route.ts"
git commit -m "Extract provider-agnostic transcript persist + AI fan-out from the Deepgram webhook

Pure refactor: the webhook's post-transcript pipeline (dictionary
rewrite, transcript upsert, embedding enqueue, audio-ready flip / blank
ai_outputs + processing + 3-job AI fan-out) moves verbatim into
persistTranscriptAndFanOut so the upcoming synchronous openai-whisper
path can run the identical downstream pipeline. No behavior change.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

After deploy: confirm the next real recording on prod reaches `ready` with a transcript (webhook path exercised end-to-end).

---

### Task 2: Pure logic (TDD) — provider resolution, whisper normalization, failure classification

**Files:**
- Create: `src/lib/transcription/provider.ts`
- Create: `src/lib/transcription/whisper-normalize.ts`
- Create: `src/lib/transcription/whisper-errors.ts`
- Test: `tests/unit/transcription-provider.test.ts`
- Test: `tests/unit/whisper-normalize.test.ts`

⚠️ `provider.ts` must use **no `@/` imports and no imports at all** — Task 4 makes `src/lib/env-check.ts` (loaded by `scripts/migrate.ts` under tsx at container boot) and `scripts/doctor.ts` import it via *relative* paths.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/transcription-provider.test.ts
import { describe, expect, it } from "vitest";
import {
  isTranscribeProvider,
  normalizedTranscribeProvider,
  resolveTranscribeProvider,
} from "@/lib/transcription/provider";
import {
  OPENAI_TRANSCRIBE_MAX_BYTES,
  classifyWhisperHttpFailure,
  whisperOversizeReason,
} from "@/lib/transcription/whisper-errors";

describe("normalizedTranscribeProvider", () => {
  it("defaults unset and empty to deepgram", () => {
    expect(normalizedTranscribeProvider(undefined)).toBe("deepgram");
    expect(normalizedTranscribeProvider("")).toBe("deepgram");
    expect(normalizedTranscribeProvider("  ")).toBe("deepgram");
  });
  it("trims and passes through explicit values verbatim", () => {
    expect(normalizedTranscribeProvider(" openai-whisper ")).toBe("openai-whisper");
    expect(normalizedTranscribeProvider("whisper")).toBe("whisper");
  });
});

describe("resolveTranscribeProvider", () => {
  it("accepts both known providers", () => {
    expect(resolveTranscribeProvider("deepgram")).toBe("deepgram");
    expect(resolveTranscribeProvider("openai-whisper")).toBe("openai-whisper");
    expect(resolveTranscribeProvider(undefined)).toBe("deepgram");
  });
  it("throws a readable error on unknown values", () => {
    expect(() => resolveTranscribeProvider("whisper")).toThrow(
      /Unknown TRANSCRIBE_PROVIDER "whisper".*deepgram.*openai-whisper/
    );
  });
  it("isTranscribeProvider narrows", () => {
    expect(isTranscribeProvider("deepgram")).toBe(true);
    expect(isTranscribeProvider("openai-whisper")).toBe(true);
    expect(isTranscribeProvider("assemblyai")).toBe(false);
  });
});

describe("whisper failure classification", () => {
  it("treats auth failures as terminal with an API-key reason", () => {
    for (const status of [401, 403]) {
      const v = classifyWhisperHttpFailure(status, "{}");
      expect(v.terminal).toBe(true);
      if (v.terminal) expect(v.reason).toMatch(/OPENAI_API_KEY/);
    }
  });
  it("treats quota exhaustion as terminal", () => {
    const v = classifyWhisperHttpFailure(
      429,
      '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}'
    );
    expect(v.terminal).toBe(true);
    if (v.terminal) expect(v.reason).toMatch(/out of credits/);
  });
  it("treats plain 429 rate limits and 5xx as retryable", () => {
    expect(classifyWhisperHttpFailure(429, '{"error":{"code":"rate_limit_exceeded"}}').terminal).toBe(false);
    expect(classifyWhisperHttpFailure(500, "oops").terminal).toBe(false);
    expect(classifyWhisperHttpFailure(503, "").terminal).toBe(false);
  });
  it("treats 400 and 413 as terminal", () => {
    expect(classifyWhisperHttpFailure(400, "bad file").terminal).toBe(true);
    const v = classifyWhisperHttpFailure(413, "");
    expect(v.terminal).toBe(true);
    if (v.terminal) expect(v.reason).toMatch(/deepgram/i);
  });
  it("oversize reason names the size, the limit, and the deepgram escape hatch", () => {
    const reason = whisperOversizeReason(30 * 1024 * 1024);
    expect(reason).toMatch(/30\.0MB/);
    expect(reason).toMatch(/25MB/);
    expect(reason).toMatch(/TRANSCRIBE_PROVIDER=deepgram/);
    expect(OPENAI_TRANSCRIBE_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});
```

```typescript
// tests/unit/whisper-normalize.test.ts
import { describe, expect, it } from "vitest";
import {
  normalizeWhisperTranscript,
  whisperLanguageToIso,
} from "@/lib/transcription/whisper-normalize";

describe("normalizeWhisperTranscript", () => {
  it("interpolates punctuated word timings across each segment, speaker 0", () => {
    const out = normalizeWhisperTranscript({
      task: "transcribe",
      language: "english",
      duration: 4,
      text: "Hello there. General Kenobi!",
      segments: [
        { start: 0, end: 2, text: " Hello there." },
        { start: 2, end: 4, text: " General Kenobi!" },
      ],
    });
    expect(out.fullText).toBe("Hello there. General Kenobi!");
    expect(out.language).toBe("en");
    expect(out.wordTimestamps).toEqual([
      { word: "Hello", start: 0, end: 1, speaker: 0 },
      { word: "there.", start: 1, end: 2, speaker: 0 },
      { word: "General", start: 2, end: 3, speaker: 0 },
      { word: "Kenobi!", start: 3, end: 4, speaker: 0 },
    ]);
  });

  it("keeps punctuation on tokens (panel renders the word array)", () => {
    const out = normalizeWhisperTranscript({
      segments: [{ start: 0, end: 1, text: "Yes, really?" }],
    });
    expect(out.wordTimestamps.map((w) => w.word)).toEqual(["Yes,", "really?"]);
  });

  it("orders out-of-order segments and skips empty ones", () => {
    const out = normalizeWhisperTranscript({
      text: "b a",
      segments: [
        { start: 5, end: 6, text: "b" },
        { start: 0, end: 1, text: "   " },
        { start: 1, end: 2, text: "a" },
      ],
    });
    expect(out.wordTimestamps.map((w) => w.word)).toEqual(["a", "b"]);
  });

  it("falls back to a single synthetic segment when segments are missing", () => {
    const out = normalizeWhisperTranscript({ text: "just text", duration: 2 });
    expect(out.fullText).toBe("just text");
    expect(out.wordTimestamps).toEqual([
      { word: "just", start: 0, end: 1, speaker: 0 },
      { word: "text", start: 1, end: 2, speaker: 0 },
    ]);
  });

  it("returns an empty transcript for an empty response", () => {
    const out = normalizeWhisperTranscript({});
    expect(out.fullText).toBe("");
    expect(out.wordTimestamps).toEqual([]);
    expect(out.language).toBe("en");
  });
});

describe("whisperLanguageToIso", () => {
  it("maps verbose_json language names to ISO codes", () => {
    expect(whisperLanguageToIso("english")).toBe("en");
    expect(whisperLanguageToIso("Spanish")).toBe("es");
    expect(whisperLanguageToIso("japanese")).toBe("ja");
  });
  it("passes through ISO-looking codes and defaults unknowns to en", () => {
    expect(whisperLanguageToIso("de")).toBe("de");
    expect(whisperLanguageToIso("pt-br")).toBe("pt-br");
    expect(whisperLanguageToIso("klingon")).toBe("en");
    expect(whisperLanguageToIso(undefined)).toBe("en");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/transcription-provider.test.ts tests/unit/whisper-normalize.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Create `src/lib/transcription/provider.ts`** (zero imports — see warning above):

```typescript
export const TRANSCRIBE_PROVIDERS = ["deepgram", "openai-whisper"] as const;
export type TranscribeProvider = (typeof TRANSCRIBE_PROVIDERS)[number];

/**
 * Shared default-and-trim semantics for TRANSCRIBE_PROVIDER, used by the
 * job, env-check, and doctor so "unset", "" and "  " all mean deepgram
 * everywhere. Returns the raw (possibly invalid) value otherwise.
 */
export function normalizedTranscribeProvider(
  value: string | undefined
): string {
  const v = value?.trim();
  return v ? v : "deepgram";
}

export function isTranscribeProvider(
  value: string
): value is TranscribeProvider {
  return (TRANSCRIBE_PROVIDERS as readonly string[]).includes(value);
}

export function resolveTranscribeProvider(
  value: string | undefined = process.env.TRANSCRIBE_PROVIDER
): TranscribeProvider {
  const v = normalizedTranscribeProvider(value);
  if (isTranscribeProvider(v)) return v;
  throw new Error(
    `Unknown TRANSCRIBE_PROVIDER "${v}" — expected "deepgram" or "openai-whisper"`
  );
}
```

- [ ] **Step 4: Create `src/lib/transcription/whisper-normalize.ts`**:

```typescript
import type { NormalizedTranscript, TranscriptWord } from "./types";

export type WhisperSegment = {
  start: number;
  end: number;
  text: string;
};

/** Subset of OpenAI's verbose_json transcription response we consume. */
export type WhisperVerboseResponse = {
  task?: string;
  language?: string;
  duration?: number;
  text?: string;
  segments?: WhisperSegment[];
};

/** Whisper has no diarization: every word is attributed to speaker 0. */
export const WHISPER_SPEAKER = 0;

/**
 * Maps verbose_json segment timestamps onto the repo's transcript shape
 * (a punctuated word timeline). Word timings are linearly interpolated
 * inside each segment, deliberately NOT taken from whisper's word-level
 * granularity: those word entries strip punctuation, and the transcript
 * panel (groupWordsIntoParagraphs) renders the word array directly —
 * punctuated interpolated words beat precise unpunctuated ones. Seek
 * precision degrades to ~segment-interpolation; paragraphing, SRT export,
 * chapters, and dictionary rewrite are unaffected.
 */
export function normalizeWhisperTranscript(
  body: WhisperVerboseResponse
): NormalizedTranscript {
  const real = (body.segments ?? [])
    .filter((segment) => segment.text.trim().length > 0)
    .sort((a, b) => a.start - b.start);

  const segments: WhisperSegment[] =
    real.length === 0 && body.text?.trim()
      ? [{ start: 0, end: body.duration ?? 0, text: body.text }]
      : real;

  const words: TranscriptWord[] = segments.flatMap((segment) => {
    const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const start = Math.max(segment.start, 0);
    const duration = Math.max(segment.end - start, 0);
    const per = duration / tokens.length;
    return tokens.map((token, i) => ({
      word: token,
      start: round3(start + per * i),
      end: round3(start + per * (i + 1)),
      speaker: WHISPER_SPEAKER,
    }));
  });

  const fullText =
    body.text?.trim() || segments.map((s) => s.text.trim()).join(" ");

  return {
    fullText,
    language: whisperLanguageToIso(body.language),
    wordTimestamps: words,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const LANGUAGE_NAME_TO_ISO: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it",
  portuguese: "pt", dutch: "nl", russian: "ru", japanese: "ja", chinese: "zh",
  korean: "ko", arabic: "ar", hindi: "hi", turkish: "tr", polish: "pl",
  ukrainian: "uk", swedish: "sv", norwegian: "no", danish: "da", finnish: "fi",
  czech: "cs", greek: "el", hebrew: "he", indonesian: "id", vietnamese: "vi",
  thai: "th", romanian: "ro", hungarian: "hu",
};

/**
 * verbose_json reports language as a lowercase English NAME ("english"),
 * not an ISO code. The transcripts.language column stores ISO codes
 * (Deepgram's detected_language convention), so map the common names and
 * pass already-ISO-looking values through.
 */
export function whisperLanguageToIso(name: string | undefined): string {
  if (!name) return "en";
  const lower = name.trim().toLowerCase();
  if (/^[a-z]{2}(-[a-z0-9]+)?$/.test(lower)) return lower;
  return LANGUAGE_NAME_TO_ISO[lower] ?? "en";
}
```

- [ ] **Step 5: Create `src/lib/transcription/whisper-errors.ts`**:

```typescript
/** OpenAI's documented upload cap for /v1/audio/transcriptions. */
export const OPENAI_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * v1 is reject-not-chunk: the extracted 16kHz mono 56kbps AAC stays under
 * 25MB for roughly an hour of audio; anything longer fails with a reason
 * that names the limit and the escape hatch.
 */
export function whisperOversizeReason(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return (
    `Transcription failed: the extracted audio is ${mb}MB, over OpenAI's ` +
    `25MB transcription upload limit (~1 hour of audio). Use ` +
    `TRANSCRIBE_PROVIDER=deepgram for long recordings, then Retry.`
  );
}

export type WhisperHttpVerdict =
  | { terminal: true; reason: string }
  | { terminal: false };

/**
 * Decides whether an OpenAI transcription HTTP failure is retryable.
 * Terminal verdicts mark the recording failed immediately (the reason is
 * the user-facing failure_reason); everything else is thrown so pg-boss
 * retries with the same options as the Deepgram path (3x, backoff).
 */
export function classifyWhisperHttpFailure(
  status: number,
  body: string
): WhisperHttpVerdict {
  if (status === 401 || status === 403) {
    return {
      terminal: true,
      reason:
        "Transcription failed: OpenAI rejected the API key (check OPENAI_API_KEY).",
    };
  }
  if (status === 413) {
    return {
      terminal: true,
      reason:
        "Transcription failed: OpenAI rejected the audio as too large (25MB limit). Use TRANSCRIBE_PROVIDER=deepgram for long recordings, then Retry.",
    };
  }
  if (
    status === 429 &&
    /insufficient_quota|exceeded your current quota/i.test(body)
  ) {
    return {
      terminal: true,
      reason:
        "Transcription failed: the OpenAI account is out of credits (insufficient_quota).",
    };
  }
  if (status === 400) {
    return {
      terminal: true,
      reason: `Transcription failed: OpenAI rejected the request (400): ${body.slice(0, 200)}`,
    };
  }
  return { terminal: false };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/transcription-provider.test.ts tests/unit/whisper-normalize.test.ts`
Expected: PASS. Then `npm run typecheck && npm run test && npm run lint` — all green.

- [ ] **Step 7: Commit and push**

```bash
git add src/lib/transcription/provider.ts src/lib/transcription/whisper-normalize.ts src/lib/transcription/whisper-errors.ts tests/unit/transcription-provider.test.ts tests/unit/whisper-normalize.test.ts
git commit -m "Add pure whisper normalization, provider resolution, and failure classification

Segment-text tokenization with linear timing interpolation (keeps
punctuation for the transcript panel; seek degrades to per-segment
interpolation), speaker 0 everywhere (whisper has no diarization),
language-name-to-ISO mapping, 25MB reject reason, and terminal-vs-retry
HTTP verdicts. All pure, all TDD'd; nothing wired up yet.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: `submitTranscription` dispatch + OpenAI whisper submission + transcribe-job rewiring

**Files:**
- Create: `src/lib/transcription/openai-whisper.ts`
- Create: `src/lib/transcription/submit.ts`
- Modify: `src/lib/queue/jobs/transcribe.ts`

The deepgram branch of `submit.ts` is a **verbatim move** of the Deepgram code currently in `runTranscribeJob` — same request fields, same callback-token flow, same 402 handling. The one deliberate semantic move: the `NEXT_PUBLIC_APP_URL` throw goes *inside* the deepgram branch (whisper needs no callback URL — that is the feature).

- [ ] **Step 1: Create `src/lib/transcription/openai-whisper.ts`**:

```typescript
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeWhisperTranscript,
  type WhisperVerboseResponse,
} from "./whisper-normalize";
import {
  OPENAI_TRANSCRIBE_MAX_BYTES,
  classifyWhisperHttpFailure,
  whisperOversizeReason,
} from "./whisper-errors";
import type { NormalizedTranscript } from "./types";

const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";

export type WhisperRunResult =
  | { ok: true; result: NormalizedTranscript; providerRequestId: string | null }
  | { ok: false; failureReason: string };

/**
 * Synchronous whisper path. ffmpeg reads the presigned URL directly (same
 * pattern as mix-audio) and re-encodes to 16kHz mono AAC @56kbps so a
 * screen recording's VIDEO track never counts against OpenAI's 25MB cap
 * (~25MB ≈ ~1 hour of audio at this bitrate). Oversize and terminal HTTP
 * failures return ok:false with a user-facing failure_reason; transient
 * failures throw so pg-boss retries.
 */
export async function runWhisperTranscription(params: {
  mediaObjectId: string;
  audioUrl: string;
  language?: string;
  terms: string[];
}): Promise<WhisperRunResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";

  const dir = await mkdtemp(join(tmpdir(), "loom-whisper-"));
  const audioPath = join(dir, "audio.m4a");
  try {
    await extractMonoAudio(params.audioUrl, audioPath);

    const { size } = await stat(audioPath);
    if (size > OPENAI_TRANSCRIBE_MAX_BYTES) {
      return { ok: false, failureReason: whisperOversizeReason(size) };
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(await readFile(audioPath))], {
        type: "audio/mp4",
      }),
      "audio.m4a"
    );
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (params.language) form.append("language", params.language);
    if (params.terms.length > 0) {
      // Whisper's closest analogue to Deepgram keyword boosting: list the
      // user's dictionary terms in the decoding prompt (~224-token cap).
      form.append("prompt", params.terms.slice(0, 60).join(", "));
    }

    const res = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      }
    );
    const providerRequestId = res.headers.get("x-request-id");
    const bodyText = await res.text();

    if (!res.ok) {
      const verdict = classifyWhisperHttpFailure(res.status, bodyText);
      if (verdict.terminal) {
        return { ok: false, failureReason: verdict.reason };
      }
      throw new Error(
        `OpenAI transcription failed (${res.status}): ${bodyText.slice(0, 300)}`
      );
    }

    const parsed = JSON.parse(bodyText) as WhisperVerboseResponse;
    return {
      ok: true,
      result: normalizeWhisperTranscript(parsed),
      providerRequestId,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function extractMonoAudio(
  inputUrl: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-i", inputUrl,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "aac",
      "-b:a", "56k",
      "-y",
      outputPath,
    ];
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const errChunks: Buffer[] = [];
    proc.stderr.on("data", (chunk) => errChunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg audio extract exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      resolve();
    });
  });
}
```

- [ ] **Step 2: Create `src/lib/transcription/submit.ts`** (the spec's provider interface; the deepgram block below must match the current `transcribe.ts` Deepgram call **field-for-field**):

```typescript
import { getDeepgramClient } from "@/lib/deepgram/client";
import { issueDeepgramCallbackToken } from "@/lib/deepgram/callback-signature";
import { isDeepgramPaymentRequiredError } from "@/lib/deepgram/errors";
import { resolveTranscribeProvider } from "./provider";
import { runWhisperTranscription } from "./openai-whisper";
import type { NormalizedTranscript } from "./types";

export type SubmitTranscriptionInput = {
  mediaObjectId: string;
  audioUrl: string;
  multichannel: boolean;
  language?: string;
  /** Canonical dictionary terms — Deepgram keywords / whisper prompt bias. */
  terms: string[];
};

export type SubmitTranscriptionOutcome =
  | { mode: "callback" }
  | {
      mode: "sync";
      result: NormalizedTranscript;
      providerRequestId: string | null;
    }
  | { mode: "failed"; failureReason: string };

/**
 * Provider dispatch — two providers, one switch (deliberately no
 * registry). deepgram returns mode:'callback' (the webhook persists);
 * openai-whisper returns mode:'sync' (the caller persists);
 * mode:'failed' means a terminal, user-explainable failure.
 */
export async function submitTranscription(
  input: SubmitTranscriptionInput
): Promise<SubmitTranscriptionOutcome> {
  const provider = resolveTranscribeProvider();

  if (provider === "openai-whisper") {
    if (input.multichannel) {
      // Whisper has no per-channel transcription; the granola stereo
      // transcript file (mic-L/system-R) is downmixed to mono by the
      // ffmpeg extract step. Speaker separation is lost — documented.
      console.log(
        `[transcribe] whisper: downmixing multichannel audio for ${input.mediaObjectId} (single speaker)`
      );
    }
    const run = await runWhisperTranscription({
      mediaObjectId: input.mediaObjectId,
      audioUrl: input.audioUrl,
      language: input.language,
      terms: input.terms,
    });
    if (!run.ok) return { mode: "failed", failureReason: run.failureReason };
    return {
      mode: "sync",
      result: run.result,
      providerRequestId: run.providerRequestId,
    };
  }

  // deepgram (default) — moved verbatim from runTranscribeJob. The
  // NEXT_PUBLIC_APP_URL requirement lives HERE, not in the job: only the
  // callback flow needs a publicly reachable URL.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  const { nonce, sig } = await issueDeepgramCallbackToken({
    recordingId: input.mediaObjectId,
  });
  const callbackUrl = `${appUrl}/api/webhooks/deepgram/${input.mediaObjectId}/${nonce}/${sig}`;

  const dg = getDeepgramClient();
  try {
    await dg.listen.v1.media.transcribeUrl({
      url: input.audioUrl,
      callback: callbackUrl,
      model: "nova-2",
      smart_format: true,
      diarize: input.multichannel ? false : true,
      ...(input.multichannel ? { multichannel: true } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.terms.length > 0 ? { keywords: input.terms } : {}),
    });
  } catch (err) {
    if (isDeepgramPaymentRequiredError(err)) {
      return {
        mode: "failed",
        failureReason:
          "Transcription failed: the Deepgram account has no credits (402 Payment Required).",
      };
    }
    throw err;
  }
  return { mode: "callback" };
}
```

- [ ] **Step 3: Rewrite `src/lib/queue/jobs/transcribe.ts`** (complete replacement — `TRANSCRIBE_JOB` and `TranscribeJobData` exports unchanged, so `boss.ts` and both retry routes need no edits):

```typescript
import { presignGet } from "@/lib/r2/presigned-get";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCanonicalTerms } from "@/db/queries/dictionary-terms";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { deepgramLanguageOption } from "@/lib/preferences/user-preferences";
import { setRecordingFailed } from "@/db/queries/recordings";
import { submitTranscription } from "@/lib/transcription/submit";
import { persistTranscriptAndFanOut } from "@/lib/transcription/persist";

export const TRANSCRIBE_JOB = "transcribe";

export type TranscribeJobData = {
  mediaObjectId: string;
  audioKey?: string;
  compositeKey?: string;
  multichannel?: boolean;
};

/**
 * Provider-dispatched transcription (TRANSCRIBE_PROVIDER):
 * - deepgram (default): async — submits with a signed callback URL; the
 *   job completes when Deepgram ACKs and the webhook persists + fans out.
 * - openai-whisper: sync — extracts audio, POSTs to OpenAI inside this
 *   job, then runs the SAME persist + fan-out the webhook runs. No
 *   public callback URL needed (localhost/LAN self-hosting works).
 *
 * Terminal failures (Deepgram 402, OpenAI auth/quota, >25MB audio) mark
 * the recording failed with a human-readable failure_reason; the owner
 * Retry button re-enqueues this same job, so switching providers between
 * attempts also Just Works.
 */
export async function runTranscribeJob(data: TranscribeJobData): Promise<void> {
  const { mediaObjectId } = data;
  const sourceKey = data.audioKey ?? data.compositeKey;
  if (!sourceKey) throw new Error("transcribe job requires audioKey");

  const audioUrl = await presignGet(sourceKey);
  const ownerId = await getMediaOwnerId(mediaObjectId);
  const preferences = ownerId ? await getUserPreferences(ownerId) : null;
  const language = deepgramLanguageOption(preferences?.transcriptionLanguage);
  const canonical = ownerId ? await getCanonicalTerms(ownerId) : [];
  const terms = canonical.slice(0, 100).map((term) => term.term);

  const outcome = await submitTranscription({
    mediaObjectId,
    audioUrl,
    multichannel: data.multichannel === true,
    language,
    terms,
  });

  if (outcome.mode === "failed") {
    await setRecordingFailed(mediaObjectId, outcome.failureReason);
    console.error(
      `[transcribe] terminal failure for media ${mediaObjectId}: ${outcome.failureReason}`
    );
    return;
  }

  if (outcome.mode === "callback") {
    console.log(
      `[transcribe] submitted Deepgram request for media ${mediaObjectId}`
    );
    return;
  }

  const persisted = await persistTranscriptAndFanOut({
    mediaObjectId,
    provider: "openai-whisper",
    providerRequestId: outcome.providerRequestId,
    transcript: outcome.result,
  });
  console.log(
    `[transcribe] whisper transcript persisted for media ${mediaObjectId} (${persisted.kind}, ${
      persisted.kind === "not_found" ? 0 : persisted.wordCount
    } words)`
  );
}

async function getMediaOwnerId(mediaObjectId: string): Promise<string | null> {
  const [media] = await db
    .select({ ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  return media?.ownerId ?? null;
}
```

Equivalence notes for review (deepgram path, provider unset): identical Deepgram request (`url`, `callback`, `model: "nova-2"`, `smart_format`, `diarize`/`multichannel`, `language`, `keywords` — same values, same conditional spreads); identical 402 → `setRecordingFailed` outcome; `getDeepgramKeywords`'s duplicate owner query is collapsed into the existing `getMediaOwnerId` call (same row, same result); the `NEXT_PUBLIC_APP_URL` throw still fires for deepgram before any Deepgram call, just from inside `submit.ts`. `deepgramLanguageOption` returns ISO-639-1 codes (or `undefined` for "auto") — exactly what whisper's `language` param takes, so it is reused as-is.

- [ ] **Step 4: Verify (automated)**

Run: `npm run typecheck && npm run test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 5: Verify (manual, whisper end-to-end on localhost — the headline use case)**

In `.env.local`: set `TRANSCRIBE_PROVIDER=openai-whisper`, a real `OPENAI_API_KEY`, and `NEXT_PUBLIC_APP_URL=http://localhost:3000` (no tunnel). Then:

```bash
npm run dev
```

Record a short (~30s) clip via the extension or upload path. Expected, in order: log `[transcribe] whisper transcript persisted for media <id> (video_processing, N words)`; recording flips `transcribing → processing → ready`; transcript panel shows punctuated paragraphs (single speaker) and clicking a paragraph seeks; title/summary/chapters/action-items populate. Then flip `.env.local` back to `TRANSCRIBE_PROVIDER=deepgram` (or remove it), restart dev, and confirm a recording still goes through the webhook path (`[transcribe] submitted Deepgram request …`). If either fails: superpowers:systematic-debugging — do not push.

- [ ] **Step 6: Commit and push**

```bash
git add src/lib/transcription/openai-whisper.ts src/lib/transcription/submit.ts src/lib/queue/jobs/transcribe.ts
git commit -m "Read TRANSCRIBE_PROVIDER: add synchronous openai-whisper transcription path

submitTranscription dispatches: deepgram (default) keeps the verbatim
async callback flow; openai-whisper extracts 16kHz mono AAC via ffmpeg
from the presigned URL, rejects >25MB with a failure_reason pointing at
Deepgram, POSTs verbose_json to /v1/audio/transcriptions, normalizes,
and runs the same persist + AI fan-out as the webhook — no public
callback URL needed, so localhost/LAN self-hosting transcribes without
a tunnel. Verified both providers end-to-end locally.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

After deploy: confirm the next prod recording (deepgram path) reaches `ready`.

---

### Task 4: Env contract + doctor validate the provider (TDD)

**Files:**
- Modify: `src/lib/env-check.ts`
- Modify: `src/lib/boot-log.ts` (surface invalid values in the boot line)
- Modify: `scripts/doctor.ts`
- Test: `tests/unit/env-check.test.ts` (extend)

⚠️ `src/lib/env-check.ts` is loaded by `scripts/migrate.ts` under tsx at **container boot** — it currently has zero imports and must only gain **relative** imports (`./transcription/provider`), never `@/` aliases. Same for `scripts/doctor.ts` (`../src/lib/transcription/provider`).

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/env-check.test.ts`:

```typescript
describe("transcription provider contract", () => {
  it("whisper provider requires OPENAI_API_KEY and drops the Deepgram warning", () => {
    const {
      DEEPGRAM_API_KEY: _1,
      DEEPGRAM_CALLBACK_SIGNING_SECRET: _2,
      ...rest
    } = FULL;
    const r = checkEnv({ ...rest, TRANSCRIBE_PROVIDER: "openai-whisper" });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("OPENAI_API_KEY");
    expect(r.warnings).not.toContain("DEEPGRAM_API_KEY");

    const withKey = checkEnv({
      ...rest,
      TRANSCRIBE_PROVIDER: "openai-whisper",
      OPENAI_API_KEY: "sk-x",
    });
    expect(withKey.ok).toBe(true);
  });

  it("empty TRANSCRIBE_PROVIDER means deepgram", () => {
    const r = checkEnv({ ...FULL, TRANSCRIBE_PROVIDER: "" });
    expect(r.ok).toBe(true);
    expect(r.invalid).toEqual([]);
  });

  it("unknown providers are invalid and fail the contract", () => {
    const r = checkEnv({ ...FULL, TRANSCRIBE_PROVIDER: "whisper" });
    expect(r.ok).toBe(false);
    expect(r.invalid.join(" ")).toMatch(/TRANSCRIBE_PROVIDER="whisper"/);
    expect(r.invalid.join(" ")).toMatch(/deepgram.*openai-whisper/);
  });

  it("assertCoreEnv throws on an invalid provider", () => {
    expect(() =>
      assertCoreEnv({ ...FULL, TRANSCRIBE_PROVIDER: "assemblyai" })
    ).toThrow(/TRANSCRIBE_PROVIDER/);
  });

  it("valid configs report empty invalid", () => {
    expect(checkEnv(FULL).invalid).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/env-check.test.ts`
Expected: FAIL — `invalid` is not on `EnvCheckResult`; whisper group missing.

- [ ] **Step 3: Update `src/lib/env-check.ts`** — add at the top:

```typescript
import {
  isTranscribeProvider,
  normalizedTranscribeProvider,
} from "./transcription/provider";
```

Replace the Deepgram group's `when` and add the whisper group right after it:

```typescript
  {
    level: "recommended",
    vars: ["DEEPGRAM_API_KEY", "DEEPGRAM_CALLBACK_SIGNING_SECRET"],
    when: (env) =>
      normalizedTranscribeProvider(env.TRANSCRIBE_PROVIDER) === "deepgram",
    hint: "Without Deepgram, recordings upload but never transcribe.",
  },
  {
    level: "required",
    vars: ["OPENAI_API_KEY"],
    when: (env) =>
      normalizedTranscribeProvider(env.TRANSCRIBE_PROVIDER) ===
      "openai-whisper",
    hint: "TRANSCRIBE_PROVIDER=openai-whisper posts audio to OpenAI's hosted Whisper.",
  },
```

Extend the result type and `checkEnv`:

```typescript
export interface EnvCheckResult {
  ok: boolean;
  /** Missing REQUIRED vars. */
  missing: string[];
  /** Missing RECOMMENDED vars (feature degrades, app still boots). */
  warnings: string[];
  /** Vars that are SET but hold an unrecognized value. */
  invalid: string[];
}

export function checkEnv(env: Env = process.env): EnvCheckResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const invalid: string[] = [];
  for (const group of GROUPS) {
    if (group.when && !group.when(env)) continue;
    const absent = group.vars.filter((name) => !env[name]);
    if (group.level === "required") missing.push(...absent);
    else warnings.push(...absent);
  }
  const provider = normalizedTranscribeProvider(env.TRANSCRIBE_PROVIDER);
  if (!isTranscribeProvider(provider)) {
    invalid.push(
      `TRANSCRIBE_PROVIDER="${provider}" (expected "deepgram" or "openai-whisper")`
    );
  }
  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    warnings,
    invalid,
  };
}
```

And in `assertCoreEnv`, after the per-group missing-var lines, add:

```typescript
  const result2 = checkEnv(env);
  for (const entry of result2.invalid) lines.push(`  - ${entry}`);
```

(or restructure to reuse the already-computed `result` — either way the thrown message must list invalid entries; keep the existing trailing "See .env.example…" line.)

- [ ] **Step 4: Update `src/lib/boot-log.ts`** — replace the `missingTag` line so invalid values surface in the one-line boot summary:

```typescript
    const broken = [...env.missing, ...env.invalid];
    const missingTag = env.ok ? "" : ` missingEnv=[${broken.join(",")}]`;
```

- [ ] **Step 5: Update `scripts/doctor.ts`.** Add imports:

```typescript
import { spawn } from "node:child_process";
import {
  isTranscribeProvider,
  normalizedTranscribeProvider,
} from "../src/lib/transcription/provider";
```

Replace `checkDeepgram` with a provider-aware check:

```typescript
async function checkTranscription() {
  const provider = normalizedTranscribeProvider(process.env.TRANSCRIBE_PROVIDER);
  if (!isTranscribeProvider(provider)) {
    return record(
      "Transcription",
      "fail",
      `unknown TRANSCRIBE_PROVIDER "${provider}" — expected "deepgram" or "openai-whisper"`
    );
  }
  if (provider === "openai-whisper") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      record(
        "Whisper (OpenAI)",
        "fail",
        "OPENAI_API_KEY is required when TRANSCRIBE_PROVIDER=openai-whisper"
      );
    } else {
      const res = await fetch("https://api.openai.com/v1/models/whisper-1", {
        headers: { Authorization: `Bearer ${key}` },
      }).catch((e) => e as Error);
      if (res instanceof Error) record("Whisper (OpenAI)", "fail", res.message);
      else
        record(
          "Whisper (OpenAI)",
          res.ok ? "ok" : "fail",
          `models/whisper-1 → ${res.status}`
        );
    }
    const ffmpegOk = await hasFfmpeg();
    record(
      "ffmpeg",
      ffmpegOk ? "ok" : "fail",
      ffmpegOk
        ? "available (whisper audio extraction)"
        : "not found — the whisper path extracts audio with ffmpeg; install it or set FFMPEG_PATH"
    );
    return;
  }
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return record("Deepgram", "warn", "no key — transcription disabled");
  try {
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${key}` },
    });
    record("Deepgram", res.ok ? "ok" : "fail", `projects → ${res.status}`);
  } catch (e) {
    record("Deepgram", "fail", (e as Error).message);
  }
}

function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], {
      stdio: "ignore",
    });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}
```

Update `checkAppUrl` (localhost is now a *positive* state under whisper — no callback needed):

```typescript
function checkAppUrl() {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!url) return record("App URL", "fail", "NEXT_PUBLIC_APP_URL not set");
  if (url.startsWith("http://localhost") || url.startsWith("http://127.")) {
    const provider = normalizedTranscribeProvider(process.env.TRANSCRIBE_PROVIDER);
    if (provider === "deepgram") {
      return record(
        "App URL",
        "warn",
        `${url} — Deepgram callbacks cannot reach localhost; use a public HTTPS URL (deploy/ngrok/tunnel) or set TRANSCRIBE_PROVIDER=openai-whisper (no callback needed)`
      );
    }
    return record(
      "App URL",
      "ok",
      `${url} (openai-whisper transcribes synchronously — no public callback URL needed)`
    );
  }
  record("App URL", "ok", url);
}
```

In `main()`: change `await checkDeepgram();` to `await checkTranscription();` and extend the env-contract line:

```typescript
  if (env.missing.length > 0 || env.invalid.length > 0)
    record(
      "Env contract",
      "fail",
      [
        env.missing.length > 0 ? `missing required: ${env.missing.join(", ")}` : "",
        env.invalid.length > 0 ? `invalid: ${env.invalid.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join(" — ")
    );
  else if (env.warnings.length > 0)
    record("Env contract", "warn", `missing optional: ${env.warnings.join(", ")}`);
  else record("Env contract", "ok", "all configured");
```

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/unit/env-check.test.ts` → PASS.
Run: `npm run typecheck && npm run test && npm run lint` → green.
Run the doctor matrix manually:
- `npm run doctor` (current `.env.local`, deepgram) → `✓ Deepgram`, App URL behaves as before.
- `TRANSCRIBE_PROVIDER=openai-whisper npm run doctor` → `✓ Whisper (OpenAI)` + `✓ ffmpeg`, and with a localhost app URL the App URL line is **ok** with the "no callback needed" note; `✗` appears if `OPENAI_API_KEY` is unset.
- `TRANSCRIBE_PROVIDER=whisper npm run doctor` → `✗ Env contract … invalid: TRANSCRIBE_PROVIDER="whisper"` and `✗ Transcription unknown TRANSCRIBE_PROVIDER`, exit 1.
- Boot fail-fast: `TRANSCRIBE_PROVIDER=whisper npm run db:migrate` → throws the readable assertCoreEnv message naming TRANSCRIBE_PROVIDER (run against the local dev DATABASE_URL only — it exits before migrating, but don't point it at prod).

- [ ] **Step 7: Commit and push**

```bash
git add src/lib/env-check.ts src/lib/boot-log.ts scripts/doctor.ts tests/unit/env-check.test.ts
git commit -m "Validate TRANSCRIBE_PROVIDER in env contract and doctor; whisper-aware checks

Unknown provider values now fail checkEnv/assertCoreEnv with a readable
message (boot fail-fast), openai-whisper requires OPENAI_API_KEY, and
doctor pings models/whisper-1 + checks ffmpeg in whisper mode. The
localhost App URL warning stays deepgram-only — under whisper, localhost
is a supported configuration and doctor now says so.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: Documentation — README decision table, env examples, changelog

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `.env.compose.example`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: `.env.example`** — replace the "Deepgram transcription" block (lines 33–35) with the block below, and **delete** the stray `TRANSCRIBE_PROVIDER=deepgram` line from the Granola section at the bottom (line 78):

```bash
# Transcription — pick ONE provider (see the README decision table).
#   deepgram (default): async + diarized (speaker labels), no length limit.
#     Requires a PUBLIC HTTPS NEXT_PUBLIC_APP_URL for the result callback.
#   openai-whisper: synchronous — works on plain http://localhost:3000 with
#     no tunnel. No speaker labels (single speaker); recordings whose audio
#     exceeds OpenAI's 25MB upload cap (~1 hour) fail with a clear error.
#     Note: the live in-meeting transcription drawer (ENABLE_GRANOLA) still
#     uses Deepgram regardless of this setting.
TRANSCRIBE_PROVIDER=deepgram

# deepgram provider
DEEPGRAM_API_KEY=dg_...
DEEPGRAM_CALLBACK_SIGNING_SECRET=replace-with-openssl-rand-hex-32

# openai-whisper provider (OPENAI_API_KEY is shared with embeddings below)
# OPENAI_TRANSCRIBE_MODEL=whisper-1   # must support verbose_json timestamps
```

- [ ] **Step 2: `.env.compose.example`** — replace the transcription block (lines 30–32) with the same content, adjusted to compose phrasing (keep the existing surrounding comment style); also append a one-line pointer next to the `NEXT_PUBLIC_APP_URL` localhost comment (line ~16): `# …or set TRANSCRIBE_PROVIDER=openai-whisper to transcribe without a public URL.`

- [ ] **Step 3: README** — four edits:

1. After the transcription mention in Requirements/Stack (around line 57, the "Local or deployed" bullet), rewrite the bullet: localhost is enough for UI/auth **and, with `TRANSCRIBE_PROVIDER=openai-whisper`, for the full record-to-transcript pipeline**; Deepgram callbacks, public share links, and unfurls still need a public HTTPS URL.
2. Add a **"Transcription: Deepgram or Whisper"** section (near the existing Deepgram setup, lines ~150–158) containing the decision table:

```markdown
### Transcription: Deepgram vs OpenAI Whisper

| | `deepgram` (default) | `openai-whisper` |
|---|---|---|
| How it runs | Async — Deepgram calls your instance back | Synchronous inside the job — no callback |
| Works on `http://localhost` / LAN, no tunnel | No — needs a public HTTPS app URL | **Yes** |
| Speaker labels (diarization) | Yes | No — whole transcript is one speaker |
| Recording length | No practical limit | ~1 hour (OpenAI 25MB audio cap); longer recordings fail with a clear reason and can be retried after switching providers |
| Live in-meeting transcript drawer (`ENABLE_GRANOLA`) | Yes | Still requires a Deepgram key |
| Keys needed | `DEEPGRAM_API_KEY` + `DEEPGRAM_CALLBACK_SIGNING_SECRET` | `OPENAI_API_KEY` |

Set `TRANSCRIBE_PROVIDER=openai-whisper` if you are self-hosting on a LAN or
just don't want to run a tunnel for local dev transcription. Everything
downstream (titles, summaries, chapters, action items, search) is identical.
A local whisper.cpp provider behind the same interface is a planned follow-up.
```

3. Troubleshooting table (line ~249): change the "Recording stuck in `transcribing`" fix cell to "Use deployed HTTPS, ngrok, or Cloudflare Tunnel — **or set `TRANSCRIBE_PROVIDER=openai-whisper` (no callback needed)**"; add a row: `Whisper recording fails with "over OpenAI's 25MB limit" | Recording longer than ~1 hour | Switch to TRANSCRIBE_PROVIDER=deepgram and press Retry on the recording`.
4. Line ~158 ("Restart `npm run dev` after changing `NEXT_PUBLIC_APP_URL`…"): append a sentence noting the whisper alternative.

- [ ] **Step 4: CHANGELOG** — add under the existing `## 2026-06-10` → `### Added` section:

```markdown
- **Pluggable transcription.** `TRANSCRIBE_PROVIDER=openai-whisper` transcribes synchronously via OpenAI Whisper — no public callback URL, so localhost/LAN self-hosting gets full transcription with zero tunnels. Deepgram remains the default and is unchanged. Whisper transcripts have no speaker labels and cap at ~1 hour (OpenAI 25MB limit); longer recordings fail with a clear reason and a Retry path. `npm run doctor` and boot-time env validation now check the provider choice, including invalid values.
```

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run test` (README/env files don't affect either — this is the cheap regression gate) and proofread the rendered README diff (`git diff README.md`).

- [ ] **Step 6: Commit and push**

```bash
git add README.md .env.example .env.compose.example CHANGELOG.md
git commit -m "Document Deepgram vs Whisper provider choice (README, env examples, changelog)

Decision table, localhost-without-tunnel use case, 25MB/~1h limit, the
live-drawer-is-still-Deepgram caveat, and a troubleshooting row for the
oversize failure. whisper.cpp noted as a future provider behind the same
interface.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

---

## Spec-coverage self-check

| Spec item | Where |
|---|---|
| Provider interface in `src/lib/transcription/`: `submitTranscription → {mode:'callback'} \| {mode:'sync', result}` | Task 3 (`submit.ts`; plus a `failed` arm for terminal reasons — productizes Phase 3's `failure_reason`) |
| `TRANSCRIBE_PROVIDER` finally read; two providers = a switch, not a registry | Task 3 (`resolveTranscribeProvider` + one switch in `submit.ts`) |
| `deepgram` default: existing async webhook path, unchanged (incl. unset/empty var) | Tasks 1–3 (verbatim moves; equivalence notes in Task 3 Step 3; default-resolution tests in Task 2) |
| `openai-whisper`: sync inside the transcribe job — download, POST, normalize to existing shape | Task 3 (`openai-whisper.ts`: ffmpeg extract → 25MB gate → verbose_json → normalize) |
| Same post-transcript persistence + AI fan-out for both providers | Task 1 (`persistTranscriptAndFanOut`, called by webhook and whisper path) |
| No public callback URL for whisper → LAN/localhost self-host, no ngrok for dev | Task 3 (`NEXT_PUBLIC_APP_URL` check moved inside deepgram branch), Task 4 (doctor App URL ok-state), Task 5 (docs) |
| 25MB limit: reject with clear `failure_reason` suggesting Deepgram; documented | Task 2 (`whisperOversizeReason`, TDD), Task 3 (size gate + `setRecordingFailed`), Task 5 (README + changelog) |
| Diarization degradation defined: single `speaker: 0`; speaker suggestions no-op gracefully | Task 2 (`WHISPER_SPEAKER`, normalization tests), Architecture note (suggest-speakers Path-B gate verified) |
| Provider choice validated by env contract (Phase 1.4) and doctor, incl. unknown values | Task 4 (required OPENAI_API_KEY group, `invalid[]`, `assertCoreEnv`, doctor `checkTranscription`) |
| whisper.cpp documented as future provider behind the same interface (out of scope) | Task 5 README section |
| Testing strategy: provider dispatch + Whisper normalization unit tests (Vitest, `tests/unit`, `@/`) | Tasks 2 + 4 (pure-logic TDD; wiring verified by typecheck/suite/manual gates) |

### Critical Files for Implementation
- /Users/iancross/Development/03Utilities/Loom_Clone/src/lib/queue/jobs/transcribe.ts
- /Users/iancross/Development/03Utilities/Loom_Clone/src/app/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]/route.ts
- /Users/iancross/Development/03Utilities/Loom_Clone/src/lib/env-check.ts
- /Users/iancross/Development/03Utilities/Loom_Clone/scripts/doctor.ts
- /Users/iancross/Development/03Utilities/Loom_Clone/src/db/queries/transcripts.ts