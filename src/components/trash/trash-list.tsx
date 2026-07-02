"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileAudio, Undo2, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type TrashItem = {
  id: string;
  type: string;
  title: string;
  createdAt: string;
  // Computed server-side: client render must stay pure (no Date.now()).
  daysLeft: number;
};

export function TrashList({ items }: { items: TrashItem[] }) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center text-sm text-text-muted">
        Trash is empty.
      </div>
    );
  }

  async function restore(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/recordings/${id}/restore`, {
        method: "POST",
      });
      if (!res.ok) {
        toast.error(`Restore failed (${res.status}).`);
        return;
      }
      toast.success("Restored to your library.");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  // Two-tap confirm (same pattern as the bulk-select bar); disarms after 3s.
  async function purge(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id);
      window.setTimeout(
        () => setConfirmingId((cur) => (cur === id ? null : cur)),
        3000
      );
      return;
    }
    setConfirmingId(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/recordings/${id}/purge`, {
        method: "POST",
      });
      if (!res.ok) {
        toast.error(`Delete failed (${res.status}).`);
        return;
      }
      toast.success("Permanently deleted.");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ul className="overflow-hidden rounded-lg border border-border bg-bg-subtle/55">
      {items.map((item) => {
        const daysLeft = item.daysLeft;
        return (
          <li
            key={item.id}
            className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            {item.type === "audio" ? (
              <FileAudio className="h-4 w-4 shrink-0 text-text-subtle" />
            ) : (
              <Video className="h-4 w-4 shrink-0 text-text-subtle" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">
                {item.title}
              </p>
              <p className="text-xs text-text-subtle">
                Recorded {new Date(item.createdAt).toLocaleDateString()} ·{" "}
                {daysLeft === 0
                  ? "deleting soon"
                  : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void restore(item.id)}
              disabled={busyId === item.id}
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              Restore
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void purge(item.id)}
              disabled={busyId === item.id}
              className={
                confirmingId === item.id
                  ? "bg-destructive/15 text-destructive hover:bg-destructive/20"
                  : "text-destructive hover:bg-destructive/10"
              }
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {confirmingId === item.id ? "Confirm?" : "Delete forever"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
