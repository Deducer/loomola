"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordGate({ slug }: { slug: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/v/${slug}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setError("Incorrect password.");
        return;
      }
      if (!res.ok) {
        setError(`Unexpected error (${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border border-border bg-bg-subtle p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-text">Password required</h2>
          <p className="text-xs text-text-muted">Enter the password to continue.</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          placeholder="Password"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          type="submit"
          disabled={submitting || password.length === 0}
          className="w-full"
        >
          {submitting ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
