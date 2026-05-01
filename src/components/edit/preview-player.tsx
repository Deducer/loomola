"use client";

import "plyr/dist/plyr.css";
import { useEffect, useRef } from "react";

/**
 * Owner-side preview player on `/recordings/[id]/edit`. Mirrors the
 * trim-clamp logic from the visitor-facing VideoPlayer so the owner
 * sees the same trimmed playback range when reviewing their work.
 *
 * Trim is a JS-side playback clamp only (the underlying MP4 is the
 * full recording). The clamp:
 *   - Pauses + rewinds when currentTime crosses trimEndSec.
 *   - Jumps to trimStartSec on loadedmetadata so playback opens at
 *     the trimmed-in point instead of frame 0.
 */
export function PreviewPlayer({
  signedUrl,
  trimStartSec,
  trimEndSec,
}: {
  signedUrl: string;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plyrRef = useRef<any>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    let cancelled = false;
    (async () => {
      const Plyr = (await import("plyr")).default;
      if (cancelled || !videoRef.current) return;
      const player = new Plyr(videoRef.current);
      plyrRef.current = player;
      player.on("timeupdate", () => {
        const t = player.currentTime ?? 0;
        if (
          typeof trimEndSec === "number" &&
          trimEndSec > 0 &&
          t >= trimEndSec
        ) {
          player.pause();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, trimEndSec - 0.05);
          }
        }
      });
      player.on("loadedmetadata", () => {
        if (
          typeof trimStartSec === "number" &&
          trimStartSec > 0 &&
          (player.currentTime ?? 0) < trimStartSec &&
          videoRef.current
        ) {
          videoRef.current.currentTime = trimStartSec;
        }
      });
    })();
    return () => {
      cancelled = true;
      plyrRef.current?.destroy?.();
      plyrRef.current = null;
    };
  }, [trimStartSec, trimEndSec]);

  return (
    <div
      className="plyr-wrapper"
      style={{ ["--plyr-color-main" as never]: "var(--accent)" }}
    >
      <video
        ref={videoRef}
        src={signedUrl}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-xl border border-border bg-black"
      />
    </div>
  );
}
