"use client";

import { useEffect, useRef } from "react";

type Props = {
  slug: string;
  isPlaying: boolean;
  getCurrentTime: () => number;
};

export function Tracking({ slug, isPlaying, getCurrentTime }: Props) {
  const firedFirstView = useRef(false);

  useEffect(() => {
    if (!isPlaying) return;
    if (!firedFirstView.current) {
      firedFirstView.current = true;
      void fetch(`/api/v/${slug}/view`, { method: "POST", keepalive: true });
    }
    const id = setInterval(() => {
      const t = getCurrentTime();
      const body = JSON.stringify({ t });
      const blob = new Blob([body], { type: "application/json" });
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/v/${slug}/progress`, blob);
      } else {
        void fetch(`/api/v/${slug}/progress`, {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
          keepalive: true,
        });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [isPlaying, slug, getCurrentTime]);

  return null;
}
