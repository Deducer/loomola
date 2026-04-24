import { checkEnv } from "./env-check";

let logged = false;

/**
 * Emits a one-line boot summary the first time it's called in a process.
 * Subsequent calls are no-ops. Useful for confirming a Coolify redeploy
 * picked up new Doppler secrets.
 */
export function logBootSummaryOnce(): void {
  if (logged) return;
  logged = true;
  try {
    const app = process.env.NEXT_PUBLIC_APP_URL ?? "?";
    const dbUrl = process.env.DATABASE_URL ?? "";
    const host = dbUrl.match(/@([^:/]+)/)?.[1] ?? "?";
    const bucket = process.env.R2_BUCKET_NAME ?? "?";
    const mg = process.env.MAILGUN_DOMAIN ?? "?";
    const env = checkEnv();
    const missingTag = env.ok ? "" : ` missingEnv=[${env.missing.join(",")}]`;
    console.log(
      `[boot] app=${app} db=${host} r2=${bucket} mailgun=${mg}${missingTag}`
    );
  } catch (e) {
    console.log(`[boot] summary failed: ${(e as Error).message}`);
  }
}
