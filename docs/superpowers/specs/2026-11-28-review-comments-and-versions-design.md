# Review comments and versions (Frame.io-style) — design

**Date:** 2026-11-28
**Status:** approved scope (Ian: "Include versions"), not built
**Why:** Loomola is now used for review links on AI film work (drafts sent to collaborators). Reviewers need to point at a spot in a frame, mark it up, and compare one draft against another. Today a comment is only `name, email, timestamp_sec, body` (`comments` in `src/db/schema.ts`), shown as seek-bar markers (`src/components/viewer/comment-markers.tsx`) and in the Comments tab, which sits in the right-hand column on wide screens since Stage 24.

Reference: Frame.io player with a numbered pin and a drawn arrow on the frame, comment list on the right with a timecode badge, pin/draw icons, reply, resolve tick: https://mobbin.com/screens/ee704edf-a186-4f30-98ed-e15525a6ac59 . Side-by-side compare: https://mobbin.com/screens/d7287068-48bd-442b-9c33-57ed9f317cc5 .

## Part 1 — Review comments

### Data (one migration, `drizzle/0037_review_comments.sql`, add to `_journal.json`)

`comments` gains:

| Column | Type | Meaning |
|---|---|---|
| `end_sec` | numeric null | Range comment end. Null = a single moment. Must be > `timestamp_sec`. |
| `annotation` | jsonb null | Pin and/or drawing on the frame at `timestamp_sec` (shape below). |
| `parent_id` | uuid null, FK comments(id) on delete cascade | Reply. Replies carry no annotation/range of their own; they inherit the parent's time for display. One level deep only. |
| `resolved_at` | timestamptz null | Set by the owner (or an agent via MCP). Only top-level comments resolve. |

`annotation` shape (validated with Zod on write; all coordinates are fractions 0–1 of the displayed video frame, so they line up at any player size and aspect ratio):

```ts
type Annotation = {
  pin?: { x: number; y: number };            // numbered marker
  strokes?: Array<{
    tool: "pen" | "arrow" | "rect";
    color: string;                             // one of a fixed palette, e.g. "#FF4D4F" "#FFC53D" "#73D13D" "#40A9FF" "#FFFFFF"
    width: number;                             // fraction of frame width, e.g. 0.004
    points: Array<[number, number]>;           // pen: polyline (simplified client-side, cap 500 points/stroke); arrow/rect: [start, end]
  }>;
};
```

Caps: 20 strokes per comment, 4 KB-ish JSON (reject over 16 KB). Colours from the palette only (reject others), so stored data can't carry arbitrary CSS.

### API

- `POST /api/v/[slug]/comments` accepts `endSec`, `annotation`, `parentId` (parent must belong to the same recording and be top-level). Same rate limit, unlock-cookie check and owner email as today; the email says "with a drawing" / "on 0:12–0:18" when relevant.
- `PATCH /api/v/[slug]/comments/[id]` — owner-only (session auth), `{ resolved: boolean }`.
- The public comments list returns the new fields; replies are nested under their parent, ordered by time.
- MCP (`src/app/api/mcp/tools/comments.ts`): `loomola_list_comments` returns `endSec`, `hasAnnotation`, `resolved`, `replies`; `loomola_post_comment` gains optional `parentId` (reply as owner); new `loomola_resolve_comment`.

### Share page UI (`src/components/viewer/`)

- **Frame-accurate time.** Use the recording's frame rate (probe with ffprobe in the existing thumbnail/transcode job and store `media_objects.fps` numeric null; fall back to 30). Comment badges show `m:ss:ff` when fps is known. While paused, `←`/`→` step one frame (`currentTime ± 1/fps`), `,`/`.` as aliases; Space toggles play. Seeking to a comment lands on the frame start (`floor(t*fps)/fps + 0.5/fps`).
- **Composer.** The comment form (now in the right column) gets a toolbar: Pin, Pen, Arrow, Box, colour swatches, Undo, Clear, and a "Range" toggle that sets an out point at the current playhead. Choosing a tool pauses the player and shows an SVG overlay exactly covering the rendered video rect (account for letterboxing: compute the content box from `videoWidth/videoHeight` vs the element box). Pointer events draw; the overlay ignores pointers when no tool is active so Plyr controls still work.
- **Viewing.** Clicking a comment seeks to its frame, pauses, and renders its annotation on the overlay with its number; the overlay clears on play. While playing, show a small numbered pin for each comment whose time is within ±0.5 s (or inside its range). Seek-bar markers become numbered; range comments render as a bar segment.
- **Threads and status.** Reply link under each comment (reuses name/email from the visitor's last comment, stored in localStorage as today if it is). Owner sees a resolve tick; resolved comments collapse and are hidden from the seek bar by default. Filter: All / Open / Resolved.
- **Mobile.** Viewing annotations works on touch; drawing is desktop-only in v1 (toolbar hidden below `md`).

## Part 2 — Versions

### Data (same migration)

`media_objects` gains `version_group_id uuid null` and `version_number int null`. A stack is every recording owned by the same user with the same `version_group_id`; the group id is the id of the first version. Unique index on `(version_group_id, version_number)`. A recording with null group is a stack of one. Comments stay per recording, i.e. per version.

### Creating versions

- **CLI / MCP (the main path for AI film drafts):** `loomola upload <file> --version-of <slug|id>` and `loomola_upload_begin { versionOf }` add the upload as the next version (inherit brand, folder, password and title prefix unless overridden). `loomola_list_versions`, `loomola_set_version_order` for agents.
- **Web edit page:** "Versions" card on `/recordings/[id]/edit`: list, reorder, "Add existing recording as a version", "Remove from stack" (it becomes standalone; nothing is deleted).
- **Dashboard:** cards in a stack show a `v3` badge and only the latest version appears in grids/lists by default (Recent DTO gains `versionCount`, `versionNumber`; the macOS app decodes them as optional and shows the badge).

### Share page

- The share URL of any version opens that version; a **version switcher** (`v1 · v2 · v3`, latest marked) sits beside the title. `?v=N` deep-links.
- **Compare** button (when the stack has 2+): two players side by side, each with its own version picker (defaults: previous vs current). One transport: play/pause/seek/frame-step drive both; each is muted except a chosen one. Keep them in sync by slaving B to A's `currentTime` on `seeked` and correcting drift > 1 frame every 500 ms while playing. On narrow screens, stack vertically. Comments column follows the right-hand player; each side's markers render on its own seek bar.
- Password: one unlock covers the whole stack (all versions share the stack's password; set on add).

## Out of scope (v1)

Wipe/overlay compare, approval statuses ("Approved / Needs changes"), per-reviewer accounts or @mentions, drawing on mobile, exporting comments as EDL/markers for Premiere/Resolve (good v2: AI film workflows end in an NLE), attachments on comments.

## Testing

- Unit: annotation Zod schema (caps, palette, ranges), letterbox content-box maths, frame snap maths, version ordering helpers, compare drift correction (pure function).
- Integration (if `SPEAKER_DB_TEST_URL`-style throwaway Postgres is available): reply/resolve permissions, version stack invariants.
- Manual in a browser against prod after deploy: draw on a 16:9 and a 9:16 video, check alignment at two window sizes and full screen; reply/resolve; compare two drafts; MCP round-trip with `loomola_list_comments`.
- `npm run typecheck`, `npm run lint`, `npx vitest run tests/unit`, `npm run build`, `cd desktop && swift build`.

## Rollout

Additive migration (all new columns nullable), runs at boot. Ship comments first, then versions, as two pushes to `main`; update README, ROADMAP (new Stage 25), CLAUDE.md and AGENTS.md, and the MCP README.
