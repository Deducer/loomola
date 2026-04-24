"use client";

import "plyr/dist/plyr.css";
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
  onPlayStateChange?: (isPlaying: boolean) => void;
  onReady?: () => void;
};

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { slug, initialSignedUrl, chapters, accentColor, onTimeUpdate, onPlayStateChange, onReady },
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
      plyrRef.current.on("play", () => onPlayStateChange?.(true));
      plyrRef.current.on("pause", () => onPlayStateChange?.(false));
      plyrRef.current.on("ended", () => onPlayStateChange?.(false));
      plyrRef.current.on("ready", () => onReady?.());
    })();
    return () => {
      cancelled = true;
      plyrRef.current?.destroy();
      plyrRef.current = null;
    };
  }, [chapters, onTimeUpdate, onPlayStateChange, onReady]);

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
