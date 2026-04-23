/**
 * Next.js calls this once at server boot (Node.js runtime only).
 * Used to eagerly start pg-boss so workers are ready before the first API
 * request that enqueues a job.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getBoss } = await import("@/lib/queue/boss");
  try {
    await getBoss();
  } catch (err) {
    // Don't crash the server on queue init failure; the first API request
    // that calls getBoss() will retry and surface a useful error.
    console.error("[instrumentation] pg-boss init failed:", err);
  }
}
