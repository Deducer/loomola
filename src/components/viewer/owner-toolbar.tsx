"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OwnerToolbar({
  recordingId,
  hasPassword,
}: {
  recordingId: string;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePassword() {
    if (password.length < 4) {
      setError("Use at least 4 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/password`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(`Save failed (${res.status}).`);
        return;
      }
      setOpen(false);
      setPassword("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removePassword() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/password`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`Remove failed (${res.status}).`);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-3 text-sm">
      <span className="opacity-60">Password:</span>
      <span className={hasPassword ? "text-emerald-300" : "opacity-70"}>
        {hasPassword ? "on" : "off"}
      </span>
      <button
        onClick={() => {
          setOpen(!open);
          setError(null);
        }}
        className="ml-auto rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
      >
        {hasPassword ? "Change" : "Add password"}
      </button>
      {hasPassword && (
        <button
          onClick={removePassword}
          disabled={busy}
          className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-200 hover:bg-red-500/30 disabled:opacity-50"
        >
          Remove
        </button>
      )}
      {open && (
        <div className="flex w-full items-center gap-2 border-t border-white/10 pt-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasPassword ? "New password" : "Password"}
            className="flex-1 rounded border border-white/20 bg-white/5 px-2 py-1 text-sm"
          />
          <button
            onClick={savePassword}
            disabled={busy}
            className="rounded bg-white/20 px-2 py-1 text-xs hover:bg-white/30 disabled:opacity-50"
          >
            Save
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
