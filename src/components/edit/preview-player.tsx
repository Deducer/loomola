"use client";

import "plyr/dist/plyr.css";
import { useEffect, useRef } from "react";

export function PreviewPlayer({ signedUrl }: { signedUrl: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plyrRef = useRef<unknown>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    let cancelled = false;
    (async () => {
      const Plyr = (await import("plyr")).default;
      if (cancelled || !videoRef.current) return;
      plyrRef.current = new Plyr(videoRef.current);
    })();
    return () => {
      cancelled = true;
      // @ts-expect-error Plyr destroy is dynamic
      plyrRef.current?.destroy?.();
      plyrRef.current = null;
    };
  }, []);

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
