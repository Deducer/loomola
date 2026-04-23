"use client";

import { useState } from "react";

export function CopyLinkButton({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard may be blocked in iframes / old browsers; noop
        }
      }}
      className={
        className ??
        "rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/5"
      }
    >
      {copied ? "Copied!" : "Copy share link"}
    </button>
  );
}
