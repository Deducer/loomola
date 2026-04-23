"use client";

import { useEffect, useState } from "react";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordingHud({
  startedAt,
  onStop,
}: {
  startedAt: number;
  onStop: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((performance.now() - startedAt) / 1000);
    }, 250);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-pulse rounded-full bg-red-500"
        />
        <span className="text-2xl font-semibold tabular-nums">
          {formatElapsed(elapsed)}
        </span>
      </div>
      <p className="max-w-md text-center text-sm opacity-60">
        Recording in progress. Click stop below or end screen sharing from the
        browser bar to finalise the recording.
      </p>
      <button
        type="button"
        onClick={onStop}
        className="rounded bg-red-500/90 px-6 py-2 text-sm font-medium text-white hover:bg-red-500"
      >
        Stop recording
      </button>
    </div>
  );
}
