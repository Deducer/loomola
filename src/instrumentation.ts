/**
 * Next.js App Router boot hook — runs once per server instance at
 * startup. Used to eagerly start pg-boss so workers begin polling the
 * queue tables immediately on container boot.
 *
 * This file is compiled for BOTH the Node and Edge runtimes. To keep
 * pg-boss + pg out of the Edge build (where their fs/net/path
 * dependencies fail webpack), the actual boot logic lives in
 * `instrumentation-node.ts`, only imported when the runtime is Node.
 *
 * Without this hook, getBoss() is lazy-init: workers don't start
 * until something (an HTTP request that hits an enqueueX call)
 * triggers the singleton. After a Coolify auto-restart that means
 * recordings silently sit in 'transcribing' / 'processing' until a
 * user happens to fire an enqueue endpoint — Ian's 72-min audio note
 * hit this on 2026-05-06 and stayed dark for 95 minutes.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // webpackIgnore tells webpack to leave this dynamic import alone
  // and resolve it at runtime. Without it, webpack still walks the
  // import graph for the Edge bundle, finds pg-boss → pg → pgpass,
  // and fails because pgpass uses Node built-ins (fs, net, path).
  // The runtime guard above ensures Edge never reaches this line.
  await import(/* webpackIgnore: true */ "./instrumentation-node");
}
