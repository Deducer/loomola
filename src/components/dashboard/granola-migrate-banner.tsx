"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY_PREFIX = "loomola.granola-migrate-banner.dismissed";

/**
 * Empty-state nudge on the dashboard. Shown only when the authenticated
 * user has zero recordings AND ENABLE_GRANOLA is true. Dismissal is
 * persisted in localStorage keyed by ownerId so the banner doesn't come
 * back next visit.
 */
export function GranolaMigrateBanner({ ownerId }: { ownerId: string }) {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(
      `${STORAGE_KEY_PREFIX}.${ownerId}`
    );
    setHidden(stored === "1");
  }, [ownerId]);

  if (hidden) return null;

  return (
    <div className="mb-6 flex items-center justify-between gap-4 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-4 text-sm">
      <div>
        <span className="font-medium text-[var(--text)]">
          Coming from Granola?{" "}
        </span>
        <Link
          className="underline underline-offset-2 hover:text-[var(--accent)]"
          href="/settings/migration"
        >
          Migrate your backlog →
        </Link>
      </div>
      <button
        aria-label="Dismiss"
        onClick={() => {
          window.localStorage.setItem(
            `${STORAGE_KEY_PREFIX}.${ownerId}`,
            "1"
          );
          setHidden(true);
        }}
        className="text-lg leading-none text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        ×
      </button>
    </div>
  );
}
