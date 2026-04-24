"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { validateTrim, type TrimError } from "@/lib/viewer/trim-validate";

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

const ERROR_LABELS: Record<TrimError, string> = {
  start_negative: "Start must be >= 0.",
  end_out_of_bounds: "End can't be past the recording duration.",
  start_ge_end: "Start must be less than end.",
};

export function TrimEditor({
  recordingId,
  durationSec,
  initialStart,
  initialEnd,
}: {
  recordingId: string;
  durationSec: number | null;
  initialStart: number | null;
  initialEnd: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(initialStart ?? 0);
  const [end, setEnd] = useState(initialEnd ?? durationSec ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (durationSec == null || durationSec <= 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm text-text-subtle">
        Trim unavailable — duration not yet known.
      </div>
    );
  }
  const dur = durationSec;
  const hasTrim = initialStart != null && initialEnd != null;
  const check = validateTrim({ startSec: start, endSec: end, durationSec: dur });

  async function save() {
    if (!check.ok) {
      setError(ERROR_LABELS[check.error]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/trim`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startSec: start, endSec: end }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error && data.error in ERROR_LABELS
            ? ERROR_LABELS[data.error as TrimError]
            : `Save failed (${res.status}).`
        );
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/trim`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`Reset failed (${res.status}).`);
        return;
      }
      setOpen(false);
      setStart(0);
      setEnd(dur);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm">
      <div className="flex items-center gap-3">
        <Scissors className="h-4 w-4 text-text-subtle" />
        <span className="text-text-muted">Trim</span>
        <span className={hasTrim ? "text-accent" : "text-text-subtle"}>
          {hasTrim
            ? `${formatTs(initialStart!)}–${formatTs(initialEnd!)}`
            : "off"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(!open);
              setError(null);
            }}
          >
            {hasTrim ? "Edit" : "Set trim"}
          </Button>
          {hasTrim && (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={busy}
              className="text-destructive hover:bg-destructive/10"
            >
              Reset
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Start: {formatTs(start)}</span>
            <span>End: {formatTs(end)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={dur}
            step={0.5}
            value={start}
            onChange={(e) => setStart(parseFloat(e.target.value))}
            className="w-full"
            style={{ accentColor: "var(--accent)" }}
          />
          <input
            type="range"
            min={0}
            max={dur}
            step={0.5}
            value={end}
            onChange={(e) => setEnd(parseFloat(e.target.value))}
            className="w-full"
            style={{ accentColor: "var(--accent)" }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setError(null);
                setStart(initialStart ?? 0);
                setEnd(initialEnd ?? dur);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy || !check.ok}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
