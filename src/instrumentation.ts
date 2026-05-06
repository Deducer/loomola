/**
 * Next.js App Router boot hook — runs once per Node.js server instance
 * at startup. Used to eagerly start pg-boss so workers begin polling
 * the queue tables immediately on container boot.
 *
 * Without this, getBoss() is lazy-init: workers don't start until
 * something (an HTTP request that hits an enqueueX call) triggers
 * the singleton. After a Coolify auto-restart that means recordings
 * silently sit in 'transcribing' / 'processing' until a user happens
 * to fire an enqueue endpoint — Ian's 72-min audio note hit this on
 * 2026-05-06 and stayed dark for 95 minutes.
 *
 * Skipped during edge runtime (the file gets imported into both, but
 * pg-boss requires Node).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Avoid running in tests / build phases.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const { getBoss } = await import("@/lib/queue/boss");
    await getBoss();
    console.log("[instrumentation] pg-boss workers warmed at boot");
  } catch (err) {
    console.error("[instrumentation] pg-boss warm-start failed:", err);
  }
}
