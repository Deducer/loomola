"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
      <div className="mt-4 rounded-lg border border-white/10 p-3 text-sm opacity-60">
        Trim: duration not available yet — try again after the recording
        finishes processing.
      </div>
    );
  }

  const hasTrim = initialStart != null && initialEnd != null;
  const check = validateTrim({ startSec: start, endSec: end, durationSec });

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
      setEnd(durationSec);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-white/10 p-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="opacity-60">Trim:</span>
        <span className={hasTrim ? "text-emerald-300" : "opacity-70"}>
          {hasTrim
            ? `${formatTs(initialStart!)}–${formatTs(initialEnd!)}`
            : "off"}
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
            setError(null);
          }}
          className="ml-auto rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
        >
          {hasTrim ? "Edit" : "Set trim"}
        </button>
        {hasTrim && (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-200 hover:bg-red-500/30 disabled:opacity-50"
          >
            Reset
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <div className="flex items-center justify-between text-xs opacity-70">
            <span>Start: {formatTs(start)}</span>
            <span>End: {formatTs(end)}</span>
          </div>
          <label className="block text-xs opacity-60">Start</label>
          <input
            type="range"
            min={0}
            max={durationSec}
            step={0.5}
            value={start}
            onChange={(e) => setStart(parseFloat(e.target.value))}
            className="w-full"
          />
          <label className="block text-xs opacity-60">End</label>
          <input
            type="range"
            min={0}
            max={durationSec}
            step={0.5}
            value={end}
            onChange={(e) => setEnd(parseFloat(e.target.value))}
            className="w-full"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
                setStart(initialStart ?? 0);
                setEnd(initialEnd ?? durationSec);
              }}
              className="rounded px-2 py-1 text-xs opacity-70 hover:opacity-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !check.ok}
              className="rounded bg-white/20 px-3 py-1 text-xs hover:bg-white/30 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
