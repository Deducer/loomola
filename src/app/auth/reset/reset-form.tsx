"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/");
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-bg-subtle p-8"
    >
      <h1 className="text-base font-semibold text-text">Choose a new password</h1>
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          {error}
        </p>
      )}
      <div>
        <label
          htmlFor="password"
          className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
        >
          New password
        </label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5"
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
