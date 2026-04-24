"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
        setError(`Slow down — try again in ${data.retryAfterSec ?? 60}s.`);
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
      className="mt-4 space-y-3 rounded-xl border border-border bg-bg-subtle p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
        />
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (not shown publicly)"
          required
        />
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment at this timestamp…"
        rows={3}
        required
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-3 text-xs text-text-subtle">
        <span>Your email is only used to notify the creator.</span>
        <Button type="submit" disabled={submitting} size="sm">
          {submitting ? "Posting…" : "Post comment"}
        </Button>
      </div>
    </form>
  );
}
