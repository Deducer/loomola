"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type Topic =
  | "setup"
  | "granola-import"
  | "loom-import"
  | "onboarding"
  | "feedback"
  | "other";

const TOPIC_OPTIONS: Array<{ value: Topic; label: string }> = [
  { value: "setup", label: "Self-hosted setup help" },
  { value: "granola-import", label: "Importing from Granola" },
  { value: "loom-import", label: "Importing from Loom (when ready)" },
  { value: "onboarding", label: "New to self-hosting or open source" },
  { value: "feedback", label: "Feedback or feature request" },
  { value: "other", label: "Something else" },
];

const INK = "#1a1612";
const SOFT_INK = "#3a342d";
const RULE = "#d4c9b3";
const ACCENT = "#7a2e1f";

export function ContactForm() {
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState<Topic>("setup");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          topic,
          message: message.trim(),
          honeypot: website,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Failed (${res.status}).`);
      }
      setState("sent");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (state === "sent") {
    return (
      <div
        className="border-l-2 py-2 pl-5"
        style={{ borderColor: ACCENT, color: INK }}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.22em]">
          Sent
        </p>
        <p
          className="mt-2 text-[1rem] leading-[1.6]"
          style={{ color: SOFT_INK }}
        >
          Thanks for the note. I'll get back to you at the email you provided.
        </p>
      </div>
    );
  }

  const inputBase =
    "w-full bg-transparent px-0 py-2 text-[1rem] outline-none transition-colors placeholder:text-[#a39c8b]";

  return (
    <form onSubmit={submit} className="space-y-7" noValidate>
      <Field label="Your email" htmlFor="contact-email">
        <input
          id="contact-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@somewhere.com"
          className={inputBase}
          style={{ borderBottom: `1px solid ${RULE}`, color: INK }}
        />
      </Field>

      <Field label="What can I help with?" htmlFor="contact-topic">
        <select
          id="contact-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value as Topic)}
          className={`${inputBase} appearance-none cursor-pointer`}
          style={{ borderBottom: `1px solid ${RULE}`, color: INK }}
        >
          {TOPIC_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Message" htmlFor="contact-message">
        <textarea
          id="contact-message"
          required
          minLength={2}
          maxLength={4000}
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Whatever's on your mind."
          className={`${inputBase} resize-y`}
          style={{ borderBottom: `1px solid ${RULE}`, color: INK }}
        />
      </Field>

      {/* Honeypot — visually hidden, no auto-complete, ignored by humans */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "-9999px",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        <label>
          Website (do not fill)
          <input
            tabIndex={-1}
            autoComplete="off"
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={state === "sending"}
          className="inline-flex items-center px-5 py-3 font-mono text-[12px] uppercase tracking-[0.18em] transition disabled:opacity-50"
          style={{
            backgroundColor: ACCENT,
            color: "#f6f1e8",
          }}
        >
          {state === "sending" ? "Sending…" : "Send"}
        </button>
        {state === "error" && error && (
          <span
            className="text-[12px]"
            style={{ color: ACCENT }}
          >
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="font-mono text-[10px] uppercase tracking-[0.22em]"
        style={{ color: SOFT_INK }}
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
