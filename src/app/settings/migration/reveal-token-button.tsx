"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function RevealTokenButton() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    setError(null);
    setCopied(false);
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.getSession();
    if (err || !data.session) {
      setError(err?.message ?? "Not signed in.");
      return;
    }
    setToken(data.session.access_token);
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (token === null) {
    return (
      <button
        onClick={reveal}
        className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        Reveal access token
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <pre className="rounded bg-[var(--bg-subtle)] p-3 text-xs overflow-x-auto break-all text-[var(--text)]">
        {token}
      </pre>
      <div className="flex items-center gap-2">
        <button
          onClick={copy}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--bg-subtle)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={() => {
            setToken(null);
            setCopied(false);
          }}
          className="rounded-md px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Hide
        </button>
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}
