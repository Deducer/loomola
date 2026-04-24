"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  slug: string;
  getCurrentTime: () => number;
};

export function CommentForm({ slug, getCurrentTime }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !body.trim()) {
      setError("All fields are required.");
      return;
    }
    setSubmitting(true);
    try {
      const timestampSec = Math.max(0, getCurrentTime());
      const res = await fetch(`/api/v/${slug}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, body, timestampSec }),
      });
      if (res.status === 429) {
        const data = (await res.json()) as { retryAfterSec?: number };
        setError(
          `You've hit the comment rate limit. Try again in ${data.retryAfterSec ?? 60}s.`
        );
        return;
      }
      if (res.status === 403) {
        setError("This recording is locked. Unlock it first.");
        return;
      }
      if (res.status === 400) {
        const data = (await res.json()) as { error?: string };
        setError(
          data.error === "bad_email"
            ? "That email looks invalid."
            : data.error === "body_too_long"
              ? "Comment too long (max 2000 chars)."
              : "Please fill in all fields."
        );
        return;
      }
      if (!res.ok) {
        setError(`Unexpected error (${res.status}).`);
        return;
      }
      setName("");
      setEmail("");
      setBody("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 space-y-2 rounded border border-white/10 p-3"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="rounded border border-white/20 bg-white/5 px-2 py-1 text-sm"
          required
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (not shown publicly)"
          className="rounded border border-white/20 bg-white/5 px-2 py-1 text-sm"
          required
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment at this timestamp…"
        rows={3}
        className="w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-sm"
        required
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-between text-xs opacity-60">
        <span>Your email is used only to notify the creator, never shown here.</span>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-white/20 px-3 py-1 text-xs hover:bg-white/30 disabled:opacity-50"
        >
          {submitting ? "Posting…" : "Post comment"}
        </button>
      </div>
    </form>
  );
}
