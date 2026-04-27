"use client";

import "plyr/dist/plyr.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChapterSegmentsOverlay } from "./chapter-segments";

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
  onPlayStateChange?: (isPlaying: boolean) => void;
  onReady?: () => void;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
  // Duration in seconds, passed in from the recording metadata.
  // Required because Chrome's <video>.duration returns Infinity for
  // MediaRecorder-produced webm files, breaking Plyr's duration display.
  durationSec?: number | null;
};

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  {
    slug,
    initialSignedUrl,
    chapters,
    accentColor,
    onTimeUpdate,
    onPlayStateChange,
    onReady,
    trimStartSec,
    trimEndSec,
    durationSec,
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plyrRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progressEl, setProgressEl] = useState<HTMLElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);

  useEffect(() => {
    if (!videoRef.current) return;
    let cancelled = false;
    (async () => {
      const Plyr = (await import("plyr")).default;
      if (cancelled || !videoRef.current) return;
      plyrRef.current = new Plyr(videoRef.current, {
        // Show elapsed time with total duration in "0:45 / 1:52" format,
        // not Plyr's default countdown (which renders weirdly when seconds
        // go briefly negative due to floating-point precision).
        invertTime: false,
        toggleInvert: false,
        displayDuration: true,
        // Chrome reports Infinity for <video>.duration on MediaRecorder
        // webms — pass the real duration explicitly so Plyr renders
        // "0:00 / 0:21" instead of "0:00 / 0:00".
        ...(durationSec && isFinite(durationSec) && durationSec > 0
          ? { duration: durationSec }
          : {}),
        controls: [
          "play-large",
          "play",
          "progress",
          "current-time",
          "duration",
          "mute",
          "volume",
          "captions",
          "settings",
          "pip",
          "airplay",
          "fullscreen",
        ],
      });
      plyrRef.current.on("timeupdate", () => {
        const t = plyrRef.current?.currentTime ?? 0;
        setCurrentTime(t);
        if (
          typeof trimEndSec === "number" &&
          trimEndSec > 0 &&
          t >= trimEndSec
        ) {
          plyrRef.current?.pause();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, trimEndSec - 0.05);
          }
          onTimeUpdate(trimEndSec);
          return;
        }
        onTimeUpdate(t);
      });
      plyrRef.current.on("play", () => onPlayStateChange?.(true));
      plyrRef.current.on("pause", () => onPlayStateChange?.(false));
      plyrRef.current.on("ended", () => onPlayStateChange?.(false));
      plyrRef.current.on("ready", () => {
        onReady?.();
        // Plyr exposes its DOM via player.elements.progress
        const el = plyrRef.current?.elements?.progress as HTMLElement | undefined;
        if (el) setProgressEl(el);
      });
      plyrRef.current.on("loadedmetadata", () => {
        const dur = videoRef.current?.duration ?? 0;
        if (isFinite(dur) && dur > 0) setTotalDuration(dur);
        if (
          typeof trimStartSec === "number" &&
          trimStartSec > 0 &&
          (plyrRef.current?.currentTime ?? 0) < trimStartSec &&
          videoRef.current
        ) {
          videoRef.current.currentTime = trimStartSec;
        }
      });
    })();
    return () => {
      cancelled = true;
      plyrRef.current?.destroy();
      plyrRef.current = null;
    };
  }, [chapters, onTimeUpdate, onPlayStateChange, onReady, trimStartSec, trimEndSec]);

  useImperativeHandle(ref, () => ({
    seek: (sec: number) => {
      const video = videoRef.current;
      if (!video) return;
      // Metadata must be loaded before a seek takes effect; otherwise the
      // browser silently stores the request and only applies it once data
      // arrives, which feels like a dead click. If unloaded, trigger a load
      // and apply the seek once `loadedmetadata` fires.
      const apply = () => {
        video.currentTime = sec;
        if (plyrRef.current) plyrRef.current.currentTime = sec;
      };
      if (video.readyState >= 1) {
        apply();
      } else {
        const onMeta = () => {
          apply();
          video.removeEventListener("loadedmetadata", onMeta);
        };
        video.addEventListener("loadedmetadata", onMeta);
        video.load();
      }
    },
    getCurrentTime: () => plyrRef.current?.currentTime ?? videoRef.current?.currentTime ?? 0,
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
    <div className="plyr-wrapper plyr-progress-on-top" style={{ ["--plyr-color-main" as never]: accentColor }}>
      <video
        ref={videoRef}
        src={initialSignedUrl}
        controls
        playsInline
        preload="metadata"
        onError={handleError}
        className="w-full overflow-hidden rounded-2xl border border-border bg-black"
      />
      <ChapterSegmentsOverlay
        progressEl={progressEl}
        chapters={chapters}
        totalDuration={totalDuration}
        currentTime={currentTime}
        onSeek={(sec) => {
          const video = videoRef.current;
          if (!video) return;
          video.currentTime = sec;
          if (plyrRef.current) plyrRef.current.currentTime = sec;
        }}
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
