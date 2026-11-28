"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { effectiveFps, snapToFrame } from "@/lib/review/frames";
import { driftCorrection } from "@/lib/review/versions";
import { buildThreads, filterThreads, type CommentThread, type ReviewComment } from "@/lib/review/comments";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { AnnotationOverlay } from "./annotation-overlay";

/** The other version shown on the left in compare mode. */
export type CompareSide = {
  slug: string;
  number: number;
  signedUrl: string;
  durationSec: number | null;
  fps: number | null;
  previewThumbnailsVttUrl: string | null;
  trimStartSec: number | null;
  trimEndSec: number | null;
  comments: ReviewComment[];
};

const NO_CHAPTERS: Array<{ start_sec: number; title: string }> = [];

/**
 * Keep the left player in step with the right (primary) one. Either
 * player's own controls drive both: play, pause and seeks are mirrored; a
 * change we made ourselves is ignored when its event comes back (play/pause
 * by a short quiet window, seeks by a pending flag cleared on `seeked`).
 * While both play, drift over one frame is corrected every 500 ms by moving
 * the left player to the right one's time.
 */
function useCompareSync(
  primaryRef: RefObject<VideoPlayerHandle | null>,
  followerRef: RefObject<VideoPlayerHandle | null>,
  fps: number
) {
  useEffect(() => {
    const a = primaryRef.current?.getVideoElement();
    const b = followerRef.current?.getVideoElement();
    if (!a || !b) return;
    const quietUntil = new Map<HTMLVideoElement, number>();
    const pendingSeek = new Set<HTMLVideoElement>();
    const half = 0.5 / fps;
    const quiet = (el: HTMLVideoElement) => quietUntil.set(el, performance.now() + 400);
    const isQuiet = (el: HTMLVideoElement) => (quietUntil.get(el) ?? 0) > performance.now();
    // Past the end of the shorter draft there's nothing to mirror to.
    const beyond = (el: HTMLVideoElement, t: number) =>
      Number.isFinite(el.duration) && el.duration > 0 && t >= el.duration - half;
    const seekTo = (el: HTMLVideoElement, t: number) => {
      if (beyond(el, t)) return;
      // Without metadata no `seeked` fires, so only flag a real seek.
      if (el.readyState >= 1) pendingSeek.add(el);
      el.currentTime = t;
    };

    const bind = (from: HTMLVideoElement, to: HTMLVideoElement) => {
      const onPlay = () => {
        if (isQuiet(from)) return;
        // The other draft already ended (it's shorter): leave it on its last
        // frame rather than restarting it from 0.
        if (to.ended || beyond(to, from.currentTime)) return;
        if (to.paused) {
          quiet(to);
          void to.play().catch(() => {});
        }
      };
      const onPause = () => {
        if (isQuiet(from)) return;
        // A shorter draft reaching its end pauses itself; don't stop the other.
        if (from.ended) return;
        if (!to.paused) {
          quiet(to);
          to.pause();
        }
        if (Math.abs(to.currentTime - from.currentTime) > half) seekTo(to, from.currentTime);
      };
      const onSeeked = () => {
        if (pendingSeek.has(from)) {
          pendingSeek.delete(from);
          return;
        }
        if (Math.abs(to.currentTime - from.currentTime) > half) seekTo(to, from.currentTime);
      };
      from.addEventListener("play", onPlay);
      from.addEventListener("pause", onPause);
      from.addEventListener("seeked", onSeeked);
      return () => {
        from.removeEventListener("play", onPlay);
        from.removeEventListener("pause", onPause);
        from.removeEventListener("seeked", onSeeked);
      };
    };
    const unbindA = bind(a, b);
    const unbindB = bind(b, a);
    if (Math.abs(a.currentTime - b.currentTime) > half) seekTo(b, a.currentTime);

    const timer = window.setInterval(() => {
      if (a.paused || b.paused || pendingSeek.has(b) || b.seeking) {
        if (b.playbackRate !== 1) b.playbackRate = 1;
        return;
      }
      const fix = driftCorrection(a.currentTime, b.currentTime, fps);
      if (fix.seekTo != null) seekTo(b, fix.seekTo);
      if (b.playbackRate !== fix.rate) b.playbackRate = fix.rate;
    }, 500);
    return () => {
      b.playbackRate = 1;
      unbindA();
      unbindB();
      window.clearInterval(timer);
    };
  }, [primaryRef, followerRef, fps]);
}

export function CompareView({
  left,
  rightNumber,
  versions,
  currentSlug,
  primaryRef,
  renderPrimary,
  primaryFps,
  accentColor,
}: {
  left: CompareSide;
  rightNumber: number;
  versions: Array<{ number: number; slug: string }>;
  currentSlug: string;
  primaryRef: RefObject<VideoPlayerHandle | null>;
  /** The page's own player (right-hand side), rendered by the shell so the
   *  comments column, keyboard and drawing tools stay wired to it. */
  renderPrimary: (opts: { muted: boolean }) => ReactNode;
  primaryFps: number | null;
  accentColor: string;
}) {
  const router = useRouter();
  const leftRef = useRef<VideoPlayerHandle | null>(null);
  const [audio, setAudio] = useState<"left" | "right">("right");
  const [leftPlaying, setLeftPlaying] = useState(false);
  const [activeLeftId, setActiveLeftId] = useState<string | null>(null);
  const fps = effectiveFps(primaryFps);
  useCompareSync(primaryRef, leftRef, fps);

  const leftThreads = useMemo(() => buildThreads(left.comments), [left.comments]);
  const leftMarkers = useMemo(() => filterThreads(leftThreads, "open"), [leftThreads]);
  const activeLeft = leftThreads.find((t) => t.id === activeLeftId) ?? null;

  const onLeftPlayState = useCallback((playing: boolean) => {
    setLeftPlaying(playing);
    if (playing) setActiveLeftId(null);
  }, []);
  const noop = useCallback(() => {}, []);

  const selectLeft = useCallback(
    (t: CommentThread) => {
      // Seeking the primary moves both; the left shows its own drawing.
      primaryRef.current?.pause();
      primaryRef.current?.seek(snapToFrame(t.timestampSec, effectiveFps(left.fps)));
      setActiveLeftId(t.id);
    },
    [primaryRef, left.fps]
  );

  const picker = (side: "left" | "right", value: number) => (
    <select
      aria-label={side === "left" ? "Left version" : "Right version"}
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (side === "left") router.push(`/v/${currentSlug}?compare=${n}`);
        else router.push(`/v/${versions[n - 1].slug}?compare=${left.number}`);
      }}
      className="rounded-md border border-border bg-bg-subtle px-2 py-1 font-mono text-xs text-text"
    >
      {versions.map((v) => (
        <option key={v.number} value={v.number} disabled={v.number === (side === "left" ? rightNumber : left.number)}>
          v{v.number}
        </option>
      ))}
    </select>
  );

  const audioButton = (side: "left" | "right") => (
    <button
      type="button"
      onClick={() => setAudio(side)}
      aria-pressed={audio === side}
      title={audio === side ? "Playing this side's sound" : "Hear this side"}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-text-subtle hover:text-text",
        audio === side && "text-accent"
      )}
    >
      <Volume2 className="h-3.5 w-3.5" />
      {audio === side ? "Sound" : "Mute"}
    </button>
  );

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            {picker("left", left.number)}
            {audioButton("left")}
            <Link
              href={`/v/${left.slug}`}
              className="ml-auto text-xs text-text-subtle hover:text-text"
              title="Open this version's own page and comments"
            >
              Open
            </Link>
          </div>
          <VideoPlayer
            ref={leftRef}
            slug={left.slug}
            initialSignedUrl={left.signedUrl}
            chapters={NO_CHAPTERS}
            accentColor={accentColor}
            onTimeUpdate={noop}
            onPlayStateChange={onLeftPlayState}
            trimStartSec={left.trimStartSec}
            trimEndSec={left.trimEndSec}
            durationSec={left.durationSec}
            previewThumbnailsVttUrl={left.previewThumbnailsVttUrl}
            threads={leftMarkers}
            onSelectThread={selectLeft}
            fps={left.fps}
            keyboard={false}
            muted={audio !== "left"}
            renderOverlay={(video) =>
              !leftPlaying && activeLeft?.annotation ? (
                <AnnotationOverlay
                  videoEl={video}
                  annotation={activeLeft.annotation}
                  label={activeLeft.number}
                  tool={null}
                  color="#FFFFFF"
                  accentColor={accentColor}
                />
              ) : null
            }
          />
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            {picker("right", rightNumber)}
            {audioButton("right")}
            <span className="ml-auto text-xs text-text-subtle">Comments follow this side</span>
          </div>
          {renderPrimary({ muted: audio !== "right" })}
        </div>
      </div>
    </div>
  );
}
