# M7 Viewer Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/v/:slug` into a public viewer with Plyr player, chapter markers on the seek bar, paragraph-synced transcript, signed-URL 403 refresh, and brand Layer 1 theming.

**Architecture:** Server component fetches data and renders a single client island (`<ViewerShell>`) that owns the Plyr ref + current-time state. The shell passes `currentTime` down to the transcript for highlight, and `onSeek(t)` down to transcript/chapters/action-items for click-to-seek. Pure utilities (paragraph grouping, active-paragraph binary search) live in `src/lib/viewer/` and are unit-tested. URL refresh goes through a new unauthenticated `POST /api/v/:slug/refresh-url`.

**Tech Stack:** Next.js 15 App Router, React 19, Plyr v3.7+, Tailwind CSS 4, Vitest.

**Reference:** [M7 design spec](../specs/2026-04-23-loom-clone-m7-viewer-page-design.md)

---

## File Structure

**New:**
- `src/lib/viewer/paragraphs.ts` — pure functions: `groupWordsIntoParagraphs`, `findActiveParagraphIndex`
- `tests/unit/viewer-paragraphs.test.ts` — unit tests for the above
- `src/app/api/v/[slug]/refresh-url/route.ts` — POST, returns fresh signed R2 URL
- `src/components/viewer/viewer-shell.tsx` — client; coordinates player ref + currentTime
- `src/components/viewer/video-player.tsx` — client; Plyr wrapper with imperative handle + 403 refresh
- `src/components/viewer/transcript-panel.tsx` — client; paragraph-synced transcript
- `src/components/viewer/chapters-list.tsx` — client; click-to-seek chapter list
- `src/components/viewer/action-items-list.tsx` — client; click-to-seek action-item list

**Modified:**
- `package.json` — add `plyr` dep
- `src/lib/supabase/middleware.ts` — allow `/api/v/` unauth
- `src/app/v/[slug]/page.tsx` — rework to render `<ViewerShell>` for all users
- `ROADMAP.md`, `CLAUDE.md` — mark M7 shipped after the live smoke test

---

## Task 1: Install Plyr

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install plyr**

Run:
```bash
npm install plyr
```

Expected: adds `"plyr": "^3.7.x"` to `dependencies` in `package.json`. No peer-dep warnings that block install.

- [ ] **Step 2: Verify the install**

Run:
```bash
node -e 'console.log(require.resolve("plyr"))'
```

Expected: prints a path inside `node_modules/plyr`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(m7): add plyr dep for viewer player"
```

---

## Task 2: Paragraph grouping utility (TDD)

**Files:**
- Create: `src/lib/viewer/paragraphs.ts`
- Create: `tests/unit/viewer-paragraphs.test.ts`

- [ ] **Step 1: Write the failing tests for `groupWordsIntoParagraphs`**

Create `tests/unit/viewer-paragraphs.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { groupWordsIntoParagraphs, type Word } from "@/lib/viewer/paragraphs";

function w(word: string, start: number, end: number): Word {
  return { word, start, end };
}

describe("groupWordsIntoParagraphs", () => {
  it("returns an empty array for no words", () => {
    expect(groupWordsIntoParagraphs([])).toEqual([]);
  });

  it("groups a single short utterance into one paragraph", () => {
    const words = [w("hello", 0, 0.5), w("world", 0.6, 1.2)];
    const result = groupWordsIntoParagraphs(words);
    expect(result).toHaveLength(1);
    expect(result[0].startSec).toBe(0);
    expect(result[0].endSec).toBe(1.2);
    expect(result[0].text).toBe("hello world");
  });

  it("splits on a long pause", () => {
    const words = [
      w("first", 0, 1),
      w("sentence", 1.1, 2),
      w("second", 10, 11),
      w("sentence", 11.1, 12),
    ];
    const result = groupWordsIntoParagraphs(words, { maxGapSec: 1.5 });
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("first sentence");
    expect(result[1].text).toBe("second sentence");
    expect(result[1].startSec).toBe(10);
  });

  it("splits on max paragraph length even without a long pause", () => {
    const words = Array.from({ length: 100 }, (_, i) => w("word", i, i + 0.9));
    const result = groupWordsIntoParagraphs(words, {
      maxGapSec: 5,
      maxParagraphSec: 30,
    });
    expect(result.length).toBeGreaterThan(1);
    result.forEach((p) => {
      expect(p.endSec - p.startSec).toBeLessThanOrEqual(31);
    });
  });

  it("uses punctuated_word when present", () => {
    const words: Word[] = [
      { word: "hello", start: 0, end: 0.5, punctuated_word: "Hello," },
      { word: "world", start: 0.6, end: 1.2, punctuated_word: "world." },
    ];
    expect(groupWordsIntoParagraphs(words)[0].text).toBe("Hello, world.");
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
npx vitest run tests/unit/viewer-paragraphs.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/viewer/paragraphs'".

- [ ] **Step 3: Implement `groupWordsIntoParagraphs`**

Create `src/lib/viewer/paragraphs.ts`:
```ts
export type Word = {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
};

export type Paragraph = {
  startSec: number;
  endSec: number;
  text: string;
};

type GroupOpts = {
  maxGapSec?: number;
  maxParagraphSec?: number;
};

const DEFAULTS: Required<GroupOpts> = {
  maxGapSec: 1.5,
  maxParagraphSec: 30,
};

/**
 * Groups Deepgram-style word timestamps into paragraphs. Starts a new
 * paragraph whenever the gap before the current word exceeds `maxGapSec`,
 * or when the running paragraph has already covered `maxParagraphSec`.
 */
export function groupWordsIntoParagraphs(
  words: Word[],
  opts: GroupOpts = {}
): Paragraph[] {
  if (words.length === 0) return [];
  const { maxGapSec, maxParagraphSec } = { ...DEFAULTS, ...opts };

  const paragraphs: Paragraph[] = [];
  let buffer: Word[] = [];
  let bufStart = words[0].start;

  const flush = () => {
    if (buffer.length === 0) return;
    paragraphs.push({
      startSec: bufStart,
      endSec: buffer[buffer.length - 1].end,
      text: buffer.map((b) => b.punctuated_word ?? b.word).join(" "),
    });
    buffer = [];
  };

  for (let i = 0; i < words.length; i++) {
    const cur = words[i];
    if (buffer.length === 0) {
      bufStart = cur.start;
      buffer.push(cur);
      continue;
    }
    const prev = buffer[buffer.length - 1];
    const gap = cur.start - prev.end;
    const runLen = cur.end - bufStart;
    if (gap > maxGapSec || runLen > maxParagraphSec) {
      flush();
      bufStart = cur.start;
    }
    buffer.push(cur);
  }
  flush();
  return paragraphs;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
npx vitest run tests/unit/viewer-paragraphs.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewer/paragraphs.ts tests/unit/viewer-paragraphs.test.ts
git commit -m "feat(viewer): paragraph grouping utility for transcript sync"
```

---

## Task 3: Active-paragraph binary search (TDD)

**Files:**
- Modify: `src/lib/viewer/paragraphs.ts`
- Modify: `tests/unit/viewer-paragraphs.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `tests/unit/viewer-paragraphs.test.ts`:
```ts
import { findActiveParagraphIndex } from "@/lib/viewer/paragraphs";

describe("findActiveParagraphIndex", () => {
  const paragraphs = [
    { startSec: 0, endSec: 5, text: "a" },
    { startSec: 5, endSec: 12, text: "b" },
    { startSec: 12, endSec: 20, text: "c" },
  ];

  it("returns -1 for empty input", () => {
    expect(findActiveParagraphIndex([], 3)).toBe(-1);
  });

  it("returns 0 before the first paragraph", () => {
    expect(findActiveParagraphIndex(paragraphs, -1)).toBe(0);
  });

  it("returns the last index past the end", () => {
    expect(findActiveParagraphIndex(paragraphs, 999)).toBe(2);
  });

  it("finds the paragraph containing the timestamp", () => {
    expect(findActiveParagraphIndex(paragraphs, 0)).toBe(0);
    expect(findActiveParagraphIndex(paragraphs, 4.9)).toBe(0);
    expect(findActiveParagraphIndex(paragraphs, 5)).toBe(1);
    expect(findActiveParagraphIndex(paragraphs, 11.9)).toBe(1);
    expect(findActiveParagraphIndex(paragraphs, 12)).toBe(2);
    expect(findActiveParagraphIndex(paragraphs, 19.9)).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
npx vitest run tests/unit/viewer-paragraphs.test.ts
```

Expected: FAIL with "findActiveParagraphIndex is not a function" (or similar import failure on that symbol).

- [ ] **Step 3: Append implementation**

Append to `src/lib/viewer/paragraphs.ts`:
```ts
/**
 * Binary search for the paragraph whose [startSec, endSec) window contains
 * `currentSec`. Returns the clamped last index if `currentSec` is past the
 * end, 0 if before the start, and -1 if the array is empty.
 */
export function findActiveParagraphIndex(
  paragraphs: Paragraph[],
  currentSec: number
): number {
  if (paragraphs.length === 0) return -1;
  if (currentSec < paragraphs[0].startSec) return 0;
  if (currentSec >= paragraphs[paragraphs.length - 1].endSec) {
    return paragraphs.length - 1;
  }
  let lo = 0;
  let hi = paragraphs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = paragraphs[mid];
    if (currentSec < p.startSec) hi = mid - 1;
    else if (currentSec >= p.endSec) lo = mid + 1;
    else return mid;
  }
  // Fallback: gap between paragraphs — return the last one that started.
  return Math.max(0, hi);
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
npx vitest run tests/unit/viewer-paragraphs.test.ts
```

Expected: all tests pass (5 from Task 2 + 4 from Task 3 = 9).

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewer/paragraphs.ts tests/unit/viewer-paragraphs.test.ts
git commit -m "feat(viewer): binary-search active-paragraph lookup"
```

---

## Task 4: Refresh-URL API route

**Files:**
- Create: `src/app/api/v/[slug]/refresh-url/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/v/[slug]/refresh-url/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { presignGet } from "@/lib/r2/presigned-get";

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
  const url = await presignGet(rec.r2CompositeKey);
  return NextResponse.json({ url });
}
```

- [ ] **Step 2: Smoke-test against dev server**

Run in one shell:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run dev
```

In another shell (replace `<slug>` with a real ready slug, e.g. `V2LyopYmWS` from earlier testing):
```bash
curl -s -X POST http://localhost:3000/api/v/<slug>/refresh-url | head -c 300
```

Expected: JSON body `{"url":"https://loom-media....r2.cloudflarestorage.com/..."}`. Stop the dev server with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v/[slug]/refresh-url/route.ts
git commit -m "feat(viewer): POST /api/v/:slug/refresh-url returns fresh signed R2 url"
```

---

## Task 5: Middleware allowlist `/api/v/`

**Files:**
- Modify: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Add the allowlist check**

Change `src/lib/supabase/middleware.ts` around line 34:
```ts
  const isPublicShare = url.pathname.startsWith("/v/");
  const isPublicViewerApi = url.pathname.startsWith("/api/v/");
  const isWebhook = url.pathname.startsWith("/api/webhooks/");

  if (!user && !isAuthRoute && !isApiHealth && !isPublicShare && !isPublicViewerApi && !isWebhook) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
```

(Keep the rest of the file identical.)

- [ ] **Step 2: Verify via curl without a session**

Start dev server:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run dev
```

In another shell:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/v/does-not-exist/refresh-url
```

Expected: `404` (not a 307 redirect to `/login`). Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/middleware.ts
git commit -m "feat(middleware): allow unauth access to /api/v/ viewer endpoints"
```

---

## Task 6: VideoPlayer component

**Files:**
- Create: `src/components/viewer/video-player.tsx`

- [ ] **Step 1: Implement the Plyr wrapper**

Create `src/components/viewer/video-player.tsx`:
```tsx
"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type Chapter = { start_sec: number; title: string };

export type VideoPlayerHandle = {
  seek: (sec: number) => void;
  getCurrentTime: () => number;
};

type Props = {
  slug: string;
  initialSignedUrl: string;
  chapters: Chapter[];
  accentColor: string;
  onTimeUpdate: (sec: number) => void;
};

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { slug, initialSignedUrl, chapters, accentColor, onTimeUpdate },
  ref
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plyrRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;
    let cancelled = false;
    (async () => {
      const Plyr = (await import("plyr")).default;
      // Side-effect CSS import.
      await import("plyr/dist/plyr.css");
      if (cancelled || !videoRef.current) return;
      plyrRef.current = new Plyr(videoRef.current, {
        markers: {
          enabled: chapters.length > 0,
          points: chapters.map((c) => ({ time: c.start_sec, label: c.title })),
        },
      });
      plyrRef.current.on("timeupdate", () => {
        onTimeUpdate(plyrRef.current?.currentTime ?? 0);
      });
    })();
    return () => {
      cancelled = true;
      plyrRef.current?.destroy();
      plyrRef.current = null;
    };
  }, [chapters, onTimeUpdate]);

  useImperativeHandle(ref, () => ({
    seek: (sec: number) => {
      if (plyrRef.current) plyrRef.current.currentTime = sec;
    },
    getCurrentTime: () => plyrRef.current?.currentTime ?? 0,
  }));

  async function refreshUrl() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/v/${slug}/refresh-url`, { method: "POST" });
      if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      const video = videoRef.current;
      if (!video || !plyrRef.current) return;
      const savedTime = video.currentTime;
      const wasPlaying = !video.paused;
      video.src = url;
      video.load();
      const onLoaded = () => {
        video.currentTime = savedTime;
        if (wasPlaying) void video.play();
        video.removeEventListener("loadedmetadata", onLoaded);
      };
      video.addEventListener("loadedmetadata", onLoaded);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "refresh_failed");
    } finally {
      setRefreshing(false);
    }
  }

  function handleError() {
    void refreshUrl();
  }

  return (
    <div className="plyr-wrapper" style={{ ["--plyr-color-main" as never]: accentColor }}>
      <video
        ref={videoRef}
        src={initialSignedUrl}
        controls
        playsInline
        onError={handleError}
        className="w-full rounded border border-white/10 bg-black"
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
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/viewer/video-player.tsx
git commit -m "feat(viewer): Plyr wrapper with 403 refresh + chapter markers"
```

---

## Task 7: ChaptersList + ActionItemsList components

**Files:**
- Create: `src/components/viewer/chapters-list.tsx`
- Create: `src/components/viewer/action-items-list.tsx`

- [ ] **Step 1: Implement ChaptersList**

Create `src/components/viewer/chapters-list.tsx`:
```tsx
"use client";

function formatTs(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

type Chapter = { start_sec: number; title: string };

export function ChaptersList({
  chapters,
  onSeek,
}: {
  chapters: Chapter[];
  onSeek: (sec: number) => void;
}) {
  if (chapters.length === 0) return null;
  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium">Chapters</h2>
      <ul className="mt-2 space-y-1">
        {chapters.map((c, i) => (
          <li key={i}>
            <button
              onClick={() => onSeek(c.start_sec)}
              className="flex w-full items-baseline gap-3 rounded px-2 py-1 text-left text-sm hover:bg-white/5"
            >
              <code className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs opacity-80">
                {formatTs(c.start_sec)}
              </code>
              <span>{c.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Implement ActionItemsList**

Create `src/components/viewer/action-items-list.tsx`:
```tsx
"use client";

function formatTs(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

type ActionItem = { timestamp_sec: number; text: string };

export function ActionItemsList({
  actionItems,
  onSeek,
}: {
  actionItems: ActionItem[];
  onSeek: (sec: number) => void;
}) {
  if (actionItems.length === 0) return null;
  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium">Action items</h2>
      <ul className="mt-2 space-y-2">
        {actionItems.map((a, i) => (
          <li key={i}>
            <button
              onClick={() => onSeek(a.timestamp_sec)}
              className="flex w-full items-baseline gap-3 rounded px-2 py-1 text-left text-sm hover:bg-white/5"
            >
              <code className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs opacity-80">
                {formatTs(a.timestamp_sec)}
              </code>
              <span>{a.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/viewer/chapters-list.tsx src/components/viewer/action-items-list.tsx
git commit -m "feat(viewer): click-to-seek chapter + action-item lists"
```

---

## Task 8: TranscriptPanel component

**Files:**
- Create: `src/components/viewer/transcript-panel.tsx`

- [ ] **Step 1: Implement**

Create `src/components/viewer/transcript-panel.tsx`:
```tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  groupWordsIntoParagraphs,
  findActiveParagraphIndex,
  type Word,
} from "@/lib/viewer/paragraphs";

export function TranscriptPanel({
  words,
  fullText,
  currentTime,
  onSeek,
}: {
  words: Word[];
  fullText: string;
  currentTime: number;
  onSeek: (sec: number) => void;
}) {
  const paragraphs = useMemo(() => groupWordsIntoParagraphs(words), [words]);
  const activeIdx = useMemo(
    () => findActiveParagraphIndex(paragraphs, currentTime),
    [paragraphs, currentTime]
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const paragraphRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = paragraphRefs.current[activeIdx];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  if (paragraphs.length === 0) {
    return (
      <div className="mt-8">
        <h2 className="text-sm font-medium">Transcript</h2>
        <p className="mt-3 rounded-lg border border-white/10 p-4 text-sm leading-relaxed opacity-80">
          {fullText || "(empty transcript)"}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium">Transcript</h2>
      <div
        ref={containerRef}
        className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-white/10 p-2"
      >
        {paragraphs.map((p, i) => (
          <button
            key={i}
            ref={(el) => {
              paragraphRefs.current[i] = el;
            }}
            onClick={() => onSeek(p.startSec)}
            className={`block w-full rounded px-2 py-2 text-left text-sm leading-relaxed transition-colors ${
              i === activeIdx
                ? "bg-white/10"
                : "opacity-70 hover:bg-white/5 hover:opacity-100"
            }`}
          >
            {p.text}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/viewer/transcript-panel.tsx
git commit -m "feat(viewer): paragraph-synced transcript panel with click-to-seek"
```

---

## Task 9: ViewerShell component

**Files:**
- Create: `src/components/viewer/viewer-shell.tsx`

- [ ] **Step 1: Implement**

Create `src/components/viewer/viewer-shell.tsx`:
```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import { ChaptersList } from "./chapters-list";
import { ActionItemsList } from "./action-items-list";
import type { Word } from "@/lib/viewer/paragraphs";

export type ViewerShellProps = {
  slug: string;
  signedVideoUrl: string;
  accentColor: string;
  chapters: Array<{ start_sec: number; title: string }>;
  actionItems: Array<{ timestamp_sec: number; text: string }>;
  words: Word[];
  fullText: string;
};

export function ViewerShell({
  slug,
  signedVideoUrl,
  accentColor,
  chapters,
  actionItems,
  words,
  fullText,
}: ViewerShellProps) {
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const handleSeek = useCallback((sec: number) => {
    playerRef.current?.seek(sec);
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
      />
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

- [ ] **Step 2: Commit**

```bash
git add src/components/viewer/viewer-shell.tsx
git commit -m "feat(viewer): ViewerShell coordinates player + transcript + lists"
```

---

## Task 10: Rework `/v/[slug]` page

**Files:**
- Modify: `src/app/v/[slug]/page.tsx` (full rewrite of the file)

- [ ] **Step 1: Rewrite the page**

Replace `src/app/v/[slug]/page.tsx` contents with:
```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { presignGet } from "@/lib/r2/presigned-get";
import { CopyLinkButton } from "@/components/share/copy-link-button";
import { ViewerShell } from "@/components/viewer/viewer-shell";
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

  const transcript = await getTranscriptByRecording(rec.id);
  const words: Word[] = Array.isArray(transcript?.wordTimestamps)
    ? (transcript.wordTimestamps as Word[])
    : [];

  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const signedVideoUrl = isReady ? await presignGet(rec.r2CompositeKey!) : null;

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
        </p>

        {rec.aiSummary && (
          <p className="mt-4 text-sm leading-relaxed opacity-80">{rec.aiSummary}</p>
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

- [ ] **Step 2: Verify the brand fields used exist**

Run:
```bash
grep -n "logoUrl\|accentColor\|brand:" src/db/queries/recordings.ts
```

Expected: confirms `rec.brand?.logoUrl`, `rec.brand?.accentColor`, and `rec.brand?.name` are valid (brand is joined in). If `logoUrl` doesn't exist on the brand shape, remove the `<img>` block and proceed with text-only header for now — record that as a follow-up.

- [ ] **Step 3: Local smoke**

Start dev server:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run dev
```

In a browser, visit `http://localhost:3000/v/V2LyopYmWS` (a known-ready slug). Expected:
- Page loads without errors in the server console.
- Plyr player renders with the composite video; seek works.
- Transcript paragraphs render; clicking a paragraph seeks.
- As video plays, transcript paragraph highlight follows.
- Chapter + action-item sections render if present.

Stop the dev server.

- [ ] **Step 4: Run type check + lint**

Run:
```bash
npm run build 2>&1 | tail -40
```

Expected: "Compiled successfully" or equivalent. No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/v/[slug]/page.tsx
git commit -m "feat(viewer): public /v/:slug renders full viewer for all users"
```

---

## Task 11: Push + live smoke + mark shipped

**Files:**
- Modify: `ROADMAP.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Push**

Run:
```bash
git push origin main
```

Wait for Coolify auto-deploy. Verify with:
```bash
until ssh vps "docker ps --format '{{.Names}} {{.Status}}' | grep yc1k629dxxsnmyg027wt5hag | grep -q 'Up [0-9]\\+ seconds'"; do sleep 10; done
```

- [ ] **Step 2: Live smoke — non-owner**

Open `https://loom.dissonance.cloud/v/<a-known-ready-slug>` in a private/incognito browser window. Verify:
- Plyr player renders and plays the composite video.
- Seek bar chapter markers visible (if chapters exist); click seeks.
- Transcript paragraphs render; highlight follows playback; click seeks.
- Brand logo (if set) + accent color visible in header.
- No "Back to dashboard" link.

- [ ] **Step 3: Live smoke — owner**

Open the same URL in a signed-in (owner) browser window. Verify:
- Same viewer UI.
- "Back to dashboard" link visible in the header.

- [ ] **Step 4: Update ROADMAP.md**

Change the M7 row in `ROADMAP.md` from:
```
| M7 | Viewer page | 🔄 next | `/v/:slug` with Plyr player, signed R2 URLs, chapters on seek bar, transcript panel |
| M8 | Password protect + view tracking | ⏳ planned | ... |
```
to:
```
| M7 | Viewer page | ✅ shipped | Public `/v/:slug` with Plyr player, 403-triggered signed-URL refresh, chapter markers on seek bar, paragraph-synced transcript with click-to-seek, action-items + chapters lists, brand Layer 1 theming (logo + accent) |
| M8 | Password protect + view tracking | 🔄 next | ... |
```

- [ ] **Step 5: Update CLAUDE.md milestone stub**

Change the line `- [ ] M7: Viewer page (Plyr + transcript + chapters)` in `CLAUDE.md` to:
```
- [x] **M7: Viewer page** — public /v/:slug with Plyr player, paragraph-synced transcript, chapter markers, signed-URL 403 refresh via /api/v/:slug/refresh-url, brand logo + accent in header.
```

- [ ] **Step 6: Commit + push**

```bash
git add ROADMAP.md CLAUDE.md
git commit -m "chore(m7): mark viewer page milestone shipped"
git push origin main
```

---

## Self-Review Notes

- Spec coverage: each bullet in "Scope (In)" maps to a task — Plyr (1, 6, 9, 10), chapter markers (6, 7), brand Layer 1 (6, 10), transcript sync (2, 3, 8), refresh (4, 6), middleware (5), public render (10). Out-of-scope items are not touched.
- Types are consistent across tasks: `Word` from `paragraphs.ts`, `Chapter` as `{ start_sec, title }`, `ActionItem` as `{ timestamp_sec, text }`, `VideoPlayerHandle = { seek, getCurrentTime }`.
- Risk mitigations from the spec:
  - If Plyr's `markers` option misbehaves, swap to absolute-positioned dots on `.plyr__progress` (keep this patch inside Task 6).
  - If `plyr.source =` resume after URL swap misbehaves, change Task 6's refresh handler to `video.src = url; video.load(); onloadedmetadata → seek + play`. The plan already uses the `video.src` approach directly.
