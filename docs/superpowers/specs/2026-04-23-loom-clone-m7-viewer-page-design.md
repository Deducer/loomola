# M7 — Viewer Page Design

**Milestone:** M7 (of Stage 1)
**Goal:** Turn `/v/:slug` into a public viewer with Plyr player, chapter markers, synced transcript, signed-URL refresh, and brand Layer 1 theming.
**Companion to:** [`2026-04-22-loom-clone-design.md`](./2026-04-22-loom-clone-design.md) → "Viewer / Share Page" section.

---

## Scope

**In:**

- Public `/v/:slug` (no login required). Owner sees the same viewer as the public, plus the existing "Back to dashboard" link.
- Plyr video player with the signed R2 URL as source.
- Chapter markers on the seek bar — click to seek, hover shows chapter title.
- Brand Layer 1 theming: `accent_color` applied via `--brand-accent` CSS variable; `logo_url` rendered in the header (if the recording has a brand profile).
- Transcript panel below the player:
  - Paragraphs grouped from Deepgram word timestamps on the client (pure function, memoized).
  - Active paragraph (the one containing the current playhead) is highlighted and scrolled into view.
  - Click any paragraph to seek.
- Chapter list + action-item list below the transcript — both click-to-seek.
- Signed-URL refresh via `POST /api/v/:slug/refresh-url` when the `<video>` element hits a 403 mid-playback.
- Owner's existing "Back to dashboard" link stays.

**Out (deferred to later milestones):**

- Password unlock flow → M8
- Comments (pins on seek bar + threaded list + notifications) → M9
- View tracking → M8
- Trim editing UI + player clamping to trim window → M10
- Creator-only edit actions (title override, delete, change brand profile, retry AI, download raw tracks) → later cleanup milestone
- Karaoke-style word-level highlight — not pursued; paragraph highlight is the bar.

---

## Architecture

### Server

- `src/app/v/[slug]/page.tsx` — existing server component. Reworked:
  - Fetches recording + transcript + ai_outputs (as today).
  - Signs the initial R2 URL for every user with `status === "ready"` (not just owner).
  - Renders `<ViewerShell>` as the single client island for all interactive bits.
- `src/app/api/v/[slug]/refresh-url/route.ts` — new `POST` route. Body: none (slug is in path). Looks up recording by slug, returns `{ url }` — a fresh 1h signed R2 URL for the composite. 404 if slug unknown or `status !== "ready"`. No auth check: the R2 signed URL itself is the security; any unauthenticated viewer can already hit the page and get a URL.

### Client components (all under `src/components/viewer/`)

- `viewer-shell.tsx` — owns the player ref + `currentTime` state. Passes `onSeek(t: number)` callback down to transcript/chapters/action-items; passes `currentTime` down to transcript for highlight. Listens to Plyr's `timeupdate` event to update `currentTime`.
- `video-player.tsx` — Plyr wrapper.
  - Receives `initialSignedUrl`, `chapters`, `accentColor`, `slug` as props.
  - Initializes Plyr on mount; sets `--plyr-color-main: var(--brand-accent)` via inline style; applies brand accent via CSS variable.
  - Renders chapter markers: uses Plyr's built-in `markers` option (arrays of `{ time: number, label: string }`) when available, otherwise renders our own absolute-positioned dots on top of `.plyr__progress`.
  - Exposes imperative handle: `{ seek(t), getCurrentTime(), getIsPlaying() }` via `forwardRef` + `useImperativeHandle`.
  - On `error` event from the inner `<video>`: POSTs to `/api/v/:slug/refresh-url`, sets `plyr.source = { type: 'video', sources: [{ src: newUrl }] }`, restores `currentTime`, resumes `play()` if it was playing before the error.
  - On URL-refresh failure: emits an `onUnrecoverableError` callback; shell shows an inline error banner.
- `transcript-panel.tsx` — receives `words: Word[]`, `fullText: string`, `currentTime: number`, `onSeek`.
  - Computes paragraph groupings once via `useMemo` from `words`.
  - Computes active paragraph index from `currentTime` using a binary search over paragraph start times.
  - `useEffect` on active index change: `paragraphRef.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` inside the scroll container.
  - Click on any paragraph → `onSeek(paragraph.startSec)`.
  - Falls back to rendering `fullText` if `words` is empty.
- `chapters-list.tsx` — receives `chapters: { start_sec, title }[]`, `onSeek`. Small ordered list; `[M:SS]` timestamp code + title per row; click → seek.
- `action-items-list.tsx` — receives `actionItems: { timestamp_sec, text }[]`, `onSeek`. Same shape as chapters.

### Pure utilities

- `src/lib/viewer/paragraphs.ts`
  - Exports `groupWordsIntoParagraphs(words, { maxGapSec = 1.5, minParagraphSec = 8, maxParagraphSec = 30 })`.
  - Returns `{ startSec: number, endSec: number, text: string }[]`.
  - Algorithm: start a new paragraph when either (a) the pause before the current word exceeds `maxGapSec`, or (b) the current running paragraph length already exceeds `maxParagraphSec`. Paragraphs shorter than `minParagraphSec` are merged forward where possible.
  - Zero React; fully unit-testable.

### Data types

```ts
// From Deepgram via transcripts.wordTimestamps (already stored)
type Word = { word: string; start: number; end: number; punctuated_word?: string };

// From ai_outputs.chapters (already stored)
type Chapter = { start_sec: number; title: string };

// From ai_outputs.action_items (already stored)
type ActionItem = { timestamp_sec: number; text: string };
```

---

## Data flow

1. User visits `/v/:slug` →
2. Server component fetches recording + transcript + ai_outputs, signs R2 URL for composite →
3. Page streams HTML with `<ViewerShell>` as a client island embedding all the props →
4. Plyr mounts with signed URL + chapter markers →
5. `timeupdate` events fire at ~250ms intervals → shell updates `currentTime` →
6. Transcript recomputes active paragraph via binary search → updates highlight class → scrolls active paragraph into view if it changed →
7. User clicks a transcript paragraph → shell calls `playerRef.current.seek(t)` → player's `timeupdate` fires → highlight moves to new position.

URL-expiry recovery:

1. User watches for 60+ minutes (or leaves tab idle past expiry) →
2. `<video>` error event fires (403 from R2) →
3. Player catches it, POSTs `/api/v/:slug/refresh-url` →
4. Server signs fresh URL and returns it →
5. Player swaps `plyr.source`, restores `currentTime`, resumes `play()` if it was playing.

---

## Error handling

- Recording not found → `notFound()` (already in page today).
- `status !== "ready"` → render a small status card ("Processing — refresh in ~30s"); no player mount; owner still sees their existing "AI outputs generating" copy.
- `r2CompositeKey` missing on a `"ready"` recording → render "Video unavailable" card; transcript/chapters/action-items still render if present.
- Transcript missing or empty → skip transcript panel; player + chapters + action items still work.
- `wordTimestamps` empty but `fullText` present → render `fullText` as a single unclickable block.
- Refresh-URL endpoint returns non-200 → player shows inline error banner, stays paused, user can click "Retry" which calls the endpoint again.

---

## Testing

**Unit** (Vitest):

- `paragraphs.test.ts`:
  - short transcript (single paragraph)
  - multiple paragraphs split by long pause
  - no pauses, split by max length
  - empty input → empty array
  - single word → single-paragraph array
- active-paragraph binary search test (pure function extracted from transcript panel): at various `currentTime` values, returns the correct index including before-first and after-last edge cases.

**Manual smoke on live** after deploy:

- Record a ~30–60s clip (long enough to generate chapters).
- Open `/v/:slug` in an incognito window (non-owner): verify
  - Player plays and seeks work.
  - Chapter markers are visible on the seek bar; hover shows title; click seeks.
  - Transcript paragraphs render; current paragraph highlighted; auto-scroll engages; click seeks.
  - Action items list renders and clicks seek.
  - Header shows brand logo (if brand profile attached) and accent color applied to progress bar.
- Same URL in owner's browser: all of the above plus "Back to dashboard" link.
- (Optional) let a recording sit for >60min with tab open, then seek to a new position to trigger 403 → refresh handler fires and playback resumes.

**Skipping Playwright:** Plyr event model, signed-URL timing, and R2 CORS are hard to exercise reliably in headless. Manual smoke covers it for M7; a full pipeline E2E is scheduled for M11.

---

## Non-goals / explicit rejections

- **Karaoke word highlight** — too much DOM churn for marginal payoff at our scale.
- **Side-by-side transcript/metadata columns on desktop** — single column (full-width) reads better; chapters already render as seek-bar markers.
- **Transcoding / adaptive bitrate** — R2 serves the composite as-is; M7 assumes modern browsers play WebM directly. Stage 2 decision.
- **Custom video element / replacing Plyr** — Plyr is spec-chosen; revisit only if a concrete blocker surfaces.
- **Client-side password check** — password flow is M8 and lives in the server component rendering path.

---

## Risks

- **Plyr + React 19 compatibility**: Plyr isn't a React component; we wrap it manually. If Plyr's event model behaves unexpectedly in Strict Mode, we fall back to a thin controlled `<video>` element with custom controls. Mitigation: validate Plyr v3.7+ works with React 19 in the first implementation task; if not, swap in a native controlled `<video>` with a progress bar + chapter markers. No other deps change.
- **Paragraph heuristic tuning**: the gap/length thresholds will need iteration against real recordings. Start with the defaults in the spec; adjust after the first live smoke test. Not a blocker for M7 shipping.
- **Signed-URL refresh inside Plyr source swap**: Plyr's `source` setter behavior on a playing element isn't ironclad; if `play()` resume after swap misbehaves, fall back to `pause() → swap → seek → play()`.
