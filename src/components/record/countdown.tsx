"use client";

import { useEffect, useRef, useState } from "react";

export function Countdown({
  seconds,
  onComplete,
  cameraStream,
}: {
  seconds: number;
  onComplete: () => void;
  cameraStream?: MediaStream | null;
}) {
  const [remaining, setRemaining] = useState(seconds);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (remaining <= 0) {
      onComplete();
      return;
    }
    const t = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onComplete]);

  // Live camera preview during the countdown so the user can see what the
  // bubble looks like + double-check framing before recording starts. The
  // stream is the same one the compositor uses, no extra getUserMedia call.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !cameraStream) return;
    v.srcObject = cameraStream;
    v.muted = true;
    void v.play().catch(() => {});
    return () => {
      v.srcObject = null;
    };
  }, [cameraStream]);

  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-6">
      {cameraStream && (
        <div
          className="relative overflow-hidden rounded-full border-2 border-white/30"
          style={{ width: 140, height: 140 }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
          />
        </div>
      )}
      {/* key remount restarts the tick animation each second */}
      <div
        key={remaining}
        className="animate-countdown-tick text-8xl font-bold tabular-nums"
      >
        {remaining > 0 ? remaining : "Go"}
      </div>
    </div>
  );
}
