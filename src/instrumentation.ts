/**
 * Next.js boot hook — register() runs once per server runtime at startup.
 * Warms pg-boss so queue workers poll from container boot instead of
 * waiting for the first enqueue-triggering HTTP request. Without this,
 * every Coolify restart leaves workers dead until someone records
 * (2026-05-06: a 72-min recording sat in 'transcribing' for 95 minutes;
 * scripts/wake-prod-boss.mjs was the manual fix).
 *
 * ⚠️ HISTORY — this file caused a full prod outage in May 2026 (commits
 * 94146b8 → c094e26, reverted in 8e5eda1). Two invariants keep it safe:
 *
 * 1. The dynamic import MUST stay INSIDE the `if` block. NEXT_RUNTIME is
 *    inlined per-bundle at build time, and webpack dead-branch-eliminates
 *    only constant `if` statements — NOT code after an early `return`.
 *    The May version used an early return, so pg/pgpass were compiled
 *    into the Edge (middleware) bundle and broke the build.
 * 2. serverExternalPackages in next.config.ts must keep "pg-boss"/"pg"
 *    external to the Node server bundle (added in 6e0feca; verified by
 *    this change's container gate).
 *
 * The try/catch means a warm-up failure can NEVER take the app down —
 * worst case we log and fall back to the pre-Phase-3 lazy init on the
 * first enqueue call.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { getBoss } = await import("@/lib/queue/boss");
      await getBoss();
      console.log("[instrumentation] pg-boss warmed at boot — workers polling");
    } catch (err) {
      console.error(
        "[instrumentation] pg-boss boot warm-up failed (app continues; workers start lazily on first enqueue):",
        err
      );
    }
  }
}
