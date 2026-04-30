"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type BrandOption = { id: string; name: string };

export function SettingsSection({
  recordingId,
  hasPassword,
  brandProfileId,
  brandOptions,
}: {
  recordingId: string;
  hasPassword: boolean;
  brandProfileId: string | null;
  brandOptions: BrandOption[];
}) {
  const router = useRouter();
  const [openPwd, setOpenPwd] = useState(false);
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
      setOpenPwd(false);
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
      setOpenPwd(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function changeBrand(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/brand`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brandProfileId: value === "" ? null : value,
        }),
      });
      if (!res.ok) {
        setError(`Brand save failed (${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <Settings className="h-3.5 w-3.5" />
        Settings
      </h2>

      <div className="mt-3 space-y-3">
        <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-text-muted">Brand</span>
            <Select
              value={brandProfileId ?? ""}
              onChange={(e) => void changeBrand(e.target.value)}
              disabled={busy}
              className="ml-auto w-56"
            >
              <option value="">No brand</option>
              {brandOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm">
          <div className="flex items-center gap-3">
            {hasPassword ? (
              <Lock className="h-4 w-4 text-emerald-400" />
            ) : (
              <LockOpen className="h-4 w-4 text-text-subtle" />
            )}
            <span className="text-text-muted">Password</span>
            <span className={hasPassword ? "text-emerald-400" : "text-text-subtle"}>
              {hasPassword ? "on" : "off"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpenPwd(!openPwd);
                  setError(null);
                }}
              >
                {hasPassword ? "Change" : "Add password"}
              </Button>
              {hasPassword && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={removePassword}
                  disabled={busy}
                  aria-label="Remove password"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
          {openPwd && (
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={hasPassword ? "New password" : "Password"}
                className="flex-1"
              />
              <Button size="sm" onClick={savePassword} disabled={busy}>
                Save
              </Button>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </section>
  );
}
