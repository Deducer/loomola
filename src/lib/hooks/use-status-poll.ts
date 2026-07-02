"use client";

import { useEffect, useRef } from "react";

/**
 * Polls `fn` while `active`, with an exponential backoff ladder and a hard
 * give-up ceiling so a stuck pipeline can't turn a left-open tab into an
 * all-day request loop (the exact shape that amplified past pg-boss
 * incidents). Fetches are skipped while the tab is hidden; returning to the
 * tab triggers an immediate catch-up tick.
 */
export function useStatusPoll(
  active: boolean,
  fn: () => Promise<void>,
  opts: {
    initialMs?: number;
    maxMs?: number;
    maxTotalMs?: number;
    onGiveUp?: () => void;
  } = {}
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const onGiveUpRef = useRef(opts.onGiveUp);
  onGiveUpRef.current = opts.onGiveUp;
  const { initialMs = 3000, maxMs = 20_000, maxTotalMs = 10 * 60_000 } = opts;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;
    let delay = initialMs;
    const startedAt = Date.now();

    const schedule = () => {
      if (cancelled) return;
      if (Date.now() - startedAt > maxTotalMs) {
        onGiveUpRef.current?.();
        return;
      }
      timer = window.setTimeout(() => void tick(), delay);
      delay = Math.min(maxMs, Math.round(delay * 1.5));
    };

    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) {
        schedule();
        return;
      }
      try {
        await fnRef.current();
      } catch {
        // Callers surface their own errors; a failed tick just retries.
      }
      schedule();
    };

    const onVisibilityChange = () => {
      if (!document.hidden && !cancelled) {
        window.clearTimeout(timer);
        void tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, initialMs, maxMs, maxTotalMs]);
}
