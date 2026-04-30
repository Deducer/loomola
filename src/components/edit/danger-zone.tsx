"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DangerZone({
  recordingId,
  title,
}: {
  recordingId: string;
  title: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    if (typed !== title) {
      setError("Type the recording's title exactly to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`Delete failed (${res.status}).`);
        return;
      }
      router.push("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        Danger zone
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        Deleting moves this recording to the trash bin (soft delete). The video
        files in R2 are kept until a future cleanup job.
      </p>
      {!confirm ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-destructive hover:bg-destructive/10"
          onClick={() => setConfirm(true)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete recording
        </Button>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-text-muted">
            Type <code className="rounded bg-bg-elevated px-1 py-0.5 text-text">{title}</code> to confirm.
          </p>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={title}
            disabled={busy}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirm(false);
                setTyped("");
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={doDelete}
              disabled={busy || typed !== title}
            >
              {busy ? "Deleting…" : "Permanently delete"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
