"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

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
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-6 rounded-xl border border-border bg-bg-subtle p-10">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-pulse rounded-full bg-destructive"
        />
        <span className="font-mono text-3xl font-semibold tabular-nums text-text">
          {formatElapsed(elapsed)}
        </span>
      </div>
      <p className="max-w-md text-center text-sm text-text-muted">
        Recording in progress. Click stop below or end screen sharing from the
        browser bar to finalise the recording.
      </p>
      <Button onClick={onStop} variant="destructive" size="lg">
        Stop recording
      </Button>
    </div>
  );
}
