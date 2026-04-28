"use client";

import { useEffect, useState } from "react";

/**
 * Tiny "this build was deployed at <time>" indicator next to the sign-out
 * button. The timestamp is baked into the bundle at build time via
 * NEXT_PUBLIC_BUILD_TIME (set in next.config.ts). Coolify rebuilds on every
 * push, so a fresh number here means the user is on the latest deploy.
 */
export function BuildStamp() {
  const iso = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";
  const [label, setLabel] = useState(iso ? "…" : "dev");

  useEffect(() => {
    if (!iso) return;
    const update = () => setLabel(formatRelative(iso));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [iso]);

  if (!iso) return null;

  return (
    <span
      title={iso}
      className="hidden text-[11px] tabular-nums text-text-subtle md:inline"
    >
      {label}
    </span>
  );
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 60) return `built ${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `built ${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `built ${hr}h ago`;
  const day = Math.round(hr / 24);
  return `built ${day}d ago`;
}
