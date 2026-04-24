const CRITICAL_ENV_VARS = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "DEEPGRAM_API_KEY",
  "DEEPGRAM_CALLBACK_SIGNING_SECRET",
  "ANTHROPIC_API_KEY",
  "VIEW_UNLOCK_SECRET",
  "VISITOR_HASH_SALT",
  "MAILGUN_API_KEY",
  "MAILGUN_DOMAIN",
  "MAIL_FROM_ADDRESS",
  "NEXT_PUBLIC_APP_URL",
] as const;

export type EnvCheckResult =
  | { ok: true }
  | { ok: false; missing: string[] };

/**
 * Non-throwing diagnostic. Returns the list of missing critical env vars
 * at call time. Intended to be logged alongside the boot summary so the
 * operator sees one clear list instead of chasing per-var errors one at
 * a time.
 */
export function checkEnv(): EnvCheckResult {
  const missing = CRITICAL_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}
