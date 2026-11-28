"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Eraser,
  MapPin,
  Pencil,
  RotateCcw,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { ANNOTATION_COLORS, isEmptyAnnotation } from "@/lib/review/annotation";
import { effectiveFps, formatTimecode, snapToFrame } from "@/lib/review/frames";
import type { ReviewComment } from "@/lib/review/comments";
import type { DrawTool } from "./annotation-overlay";
import {
  EMPTY_DRAFT,
  commentErrorMessage,
  loadIdentity,
  saveIdentity,
  type ReviewDraft,
} from "./review-draft";

type Props = {
  slug: string;
  fps: number | null;
  currentTime: number;
  getCurrentTime: () => number;
  /** Called with the freshly-created comment so the parent can add it to
   *  local state immediately (router.refresh() re-syncs later). */
  onCommentAdded?: (comment: ReviewComment) => void;
  /** Top-level composer only: the drawing/range draft lives in the shell
   *  because the overlay that edits it sits inside the player. */
  draft?: ReviewDraft;
  onDraftChange?: (next: ReviewDraft) => void;
  /** Choosing a tool pauses the player and anchors the draft. */
  onToolChange?: (tool: DrawTool | null) => void;
  onShowDraft?: () => void;
  /** Reply variant: posts into this thread, no toolbar. */
  parentId?: string;
  onCancel?: () => void;
};

const TOOLS: Array<{ tool: DrawTool; label: string; Icon: typeof Pencil }> = [
  { tool: "pin", label: "Pin", Icon: MapPin },
  { tool: "pen", label: "Pen", Icon: Pencil },
  { tool: "arrow", label: "Arrow", Icon: ArrowUpRight },
  { tool: "rect", label: "Box", Icon: Square },
];

export function CommentForm({
  slug,
  fps,
  currentTime,
  getCurrentTime,
  onCommentAdded,
  draft,
  onDraftChange,
  onToolChange,
  onShowDraft,
  parentId,
  onCancel,
}: Props) {
  const router = useRouter();
  const isReply = !!parentId;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [knownIdentity, setKnownIdentity] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fpsEff = effectiveFps(fps);

  useEffect(() => {
    const id = loadIdentity();
    if (id) {
      setName(id.name);
      setEmail(id.email);
      setKnownIdentity(true);
    }
  }, []);

  const d = draft ?? EMPTY_DRAFT;
  const hasDrawing = !isEmptyAnnotation(d.annotation);
  const startSec = d.anchorSec ?? snapToFrame(currentTime, fpsEff);

  function update(patch: Partial<ReviewDraft>) {
    onDraftChange?.({ ...d, ...patch });
  }

  function anchorNow() {
    if (d.anchorSec === null) update({ anchorSec: snapToFrame(getCurrentTime(), fpsEff) });
  }

  function toggleRange() {
    if (d.endSec !== null) {
      update({ endSec: null });
      return;
    }
    const now = snapToFrame(getCurrentTime(), fpsEff);
    if (d.anchorSec === null) {
      // First click marks the in point; the next one (after moving the
      // playhead) sets the out point.
      update({ anchorSec: now });
      setError("In point set. Move to the out point and click Range again.");
      return;
    }
    if (now <= d.anchorSec) {
      setError("Move the playhead past the in point, then click Range.");
      return;
    }
    setError(null);
    update({ endSec: now });
  }

  function undo() {
    const strokes = d.annotation.strokes ?? [];
    if (strokes.length > 0) {
      update({ annotation: { ...d.annotation, strokes: strokes.slice(0, -1) } });
    } else if (d.annotation.pin) {
      update({ annotation: { ...d.annotation, pin: undefined } });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !body.trim()) {
      setError("All fields are required.");
      return;
    }
    setSubmitting(true);
    try {
      const timestampSec = isReply ? 0 : d.anchorSec ?? snapToFrame(Math.max(0, getCurrentTime()), fpsEff);
      const res = await fetch(`/api/v/${slug}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          body,
          timestampSec,
          ...(isReply ? { parentId } : {}),
          ...(!isReply && d.endSec !== null ? { endSec: d.endSec } : {}),
          ...(!isReply && hasDrawing ? { annotation: d.annotation } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          retryAfterSec?: number;
        };
        setError(commentErrorMessage(res.status, data.error, data.retryAfterSec));
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { id: string; comment?: ReviewComment }
        | null;
      if (data?.comment && onCommentAdded) onCommentAdded(data.comment);
      saveIdentity({ name: name.trim(), email: email.trim() });
      setKnownIdentity(true);
      setBody("");
      if (!isReply) onDraftChange?.({ ...EMPTY_DRAFT, color: d.color });
      onCancel?.();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const identityFields = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        required
      />
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email (not shown publicly)"
        required
      />
    </div>
  );

  if (isReply) {
    return (
      <form onSubmit={onSubmit} className="mt-2 space-y-2">
        {!knownIdentity && identityFields}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Reply…"
          rows={2}
          autoFocus
          required
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-2 text-xs text-text-subtle">
          {knownIdentity && (
            <button
              type="button"
              className="mr-auto hover:text-text"
              onClick={() => setKnownIdentity(false)}
            >
              as {name}
            </button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting} size="sm">
            {submitting ? "Posting…" : "Reply"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 space-y-3 rounded-xl border border-border bg-bg-subtle p-4"
    >
      {identityFields}
      {/* Drawing is desktop-only in v1. */}
      <div className="hidden flex-wrap items-center gap-1 md:flex" role="toolbar" aria-label="Annotate the frame">
        {TOOLS.map(({ tool, label, Icon }) => (
          <button
            key={tool}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={d.tool === tool}
            onClick={() => onToolChange?.(d.tool === tool ? null : tool)}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-elevated hover:text-text",
              d.tool === tool && "bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={`Colour ${c}`}
            aria-label={`Colour ${c}`}
            aria-pressed={d.color === c}
            onClick={() => update({ color: c })}
            className={cn(
              "h-4 w-4 rounded-full border border-black/30 transition-transform",
              d.color === c ? "scale-110 ring-2 ring-accent ring-offset-1 ring-offset-bg-subtle" : "hover:scale-110"
            )}
            style={{ background: c }}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <button
          type="button"
          title="Undo"
          aria-label="Undo last mark"
          disabled={!hasDrawing}
          onClick={undo}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text disabled:opacity-40"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Clear drawing"
          aria-label="Clear drawing"
          disabled={!hasDrawing}
          onClick={() => update({ annotation: {} })}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={toggleRange}
          aria-pressed={d.endSec !== null}
          className={cn(
            "ml-auto rounded-md px-2 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text",
            d.endSec !== null && "bg-accent/15 text-accent"
          )}
          title="Comment on a range: set the out point at the playhead"
        >
          Range
        </button>
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onFocus={anchorNow}
        placeholder="Add a comment at this frame…"
        rows={3}
        required
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-subtle">
        <span className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
          {formatTimecode(startSec, fps)}
          {d.endSec !== null ? `–${formatTimecode(d.endSec, fps)}` : ""}
        </span>
        {hasDrawing && (
          <button type="button" onClick={onShowDraft} className="hover:text-text">
            with a drawing · show
          </button>
        )}
        {d.anchorSec !== null && (
          <button
            type="button"
            onClick={() => update({ anchorSec: null, endSec: null })}
            className="inline-flex items-center gap-1 hover:text-text"
            title="Use the playhead's time instead"
          >
            <RotateCcw className="h-3 w-3" /> follow playhead
          </button>
        )}
        {(hasDrawing || d.endSec !== null) && (
          <button
            type="button"
            onClick={() => onDraftChange?.({ ...EMPTY_DRAFT, color: d.color })}
            className="inline-flex items-center gap-1 hover:text-text"
          >
            <X className="h-3 w-3" /> discard marks
          </button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-3 text-xs text-text-subtle">
        <span>Your email is only used to notify the creator.</span>
        <Button type="submit" disabled={submitting} size="sm">
          {submitting ? "Posting…" : "Post comment"}
        </Button>
      </div>
    </form>
  );
}
