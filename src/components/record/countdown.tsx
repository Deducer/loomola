"use client";

import { useEffect, useState } from "react";

export function Countdown({
  seconds,
  onComplete,
}: {
  seconds: number;
  onComplete: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onComplete();
      return;
    }
    const t = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onComplete]);

  return (
    <div className="flex min-h-[300px] items-center justify-center">
      <div
        key={remaining}
        className="text-8xl font-bold tabular-nums"
      >
        {remaining > 0 ? remaining : "Go"}
      </div>
    </div>
  );
}
