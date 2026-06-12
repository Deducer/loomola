import {
  isTranscribeProvider,
  normalizedTranscribeProvider,
} from "./transcription/provider";

type Env = Record<string, string | undefined>;

interface EnvGroup {
  /** required = boot fails without it; recommended = boot warns. */
  level: "required" | "recommended";
  vars: string[];
  /** Group only applies when this predicate is true. */
  when?: (env: Env) => boolean;
  hint: string;
}

const GROUPS: EnvGroup[] = [
  {
    level: "required",
    vars: [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_APP_URL",
      "VIEW_UNLOCK_SECRET",
      "VISITOR_HASH_SALT",
    ],
    hint: "Core: Supabase project + app URL + `openssl rand -hex 32` secrets.",
  },
  {
    level: "required",
    vars: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"],
    hint: "Object storage credentials (Cloudflare R2, MinIO, or any S3-compatible store).",
  },
  {
    level: "required",
    vars: ["R2_ACCOUNT_ID"],
    when: (env) => !env.S3_ENDPOINT,
    hint: "Cloudflare R2 account id — or set S3_ENDPOINT to use MinIO/S3 instead.",
  },
  {
    level: "required",
    vars: ["OPENAI_API_KEY"],
    when: (env) => env.ENABLE_GRANOLA === "true",
    hint: "Granola features need OpenAI embeddings.",
  },
  {
    level: "recommended",
    vars: ["DEEPGRAM_API_KEY", "DEEPGRAM_CALLBACK_SIGNING_SECRET"],
    when: (env) =>
      normalizedTranscribeProvider(env.TRANSCRIBE_PROVIDER) === "deepgram",
    hint: "Without Deepgram, recordings upload but never transcribe.",
  },
  {
    level: "required",
    vars: ["OPENAI_API_KEY"],
    when: (env) =>
      normalizedTranscribeProvider(env.TRANSCRIBE_PROVIDER) ===
      "openai-whisper",
    hint: "TRANSCRIBE_PROVIDER=openai-whisper posts audio to OpenAI's hosted Whisper.",
  },
  {
    level: "recommended",
    vars: ["ANTHROPIC_API_KEY"],
    when: (env) => (env.LLM_PROVIDER ?? "anthropic") === "anthropic",
    hint: "Without an LLM key, titles/summaries/chapters are never generated.",
  },
  {
    level: "recommended",
    vars: ["OPENROUTER_API_KEY"],
    when: (env) => env.LLM_PROVIDER === "openrouter",
    hint: "LLM_PROVIDER=openrouter needs OPENROUTER_API_KEY.",
  },
  {
    level: "recommended",
    vars: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAIL_FROM_ADDRESS"],
    hint: "Email is optional — comment/view notifications are skipped without it.",
  },
];

export interface EnvCheckResult {
  ok: boolean;
  /** Missing REQUIRED vars. */
  missing: string[];
  /** Missing RECOMMENDED vars (feature degrades, app still boots). */
  warnings: string[];
  /** Vars that are SET but hold an unrecognized value. */
  invalid: string[];
}

export function checkEnv(env: Env = process.env): EnvCheckResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const invalid: string[] = [];
  for (const group of GROUPS) {
    if (group.when && !group.when(env)) continue;
    const absent = group.vars.filter((name) => !env[name]);
    if (group.level === "required") missing.push(...absent);
    else warnings.push(...absent);
  }
  const provider = normalizedTranscribeProvider(env.TRANSCRIBE_PROVIDER);
  if (!isTranscribeProvider(provider)) {
    invalid.push(
      `TRANSCRIBE_PROVIDER="${provider}" (expected "deepgram" or "openai-whisper")`
    );
  }
  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    warnings,
    invalid,
  };
}

/**
 * Throws with a setup-guide-shaped message when any REQUIRED var is missing.
 * Called from the production boot path (scripts/migrate.ts) so a broken
 * container fails in seconds with one readable list instead of crashing
 * lazily inside a request hours later.
 */
export function assertCoreEnv(env: Env = process.env): void {
  const result = checkEnv(env);
  if (result.ok) return;
  const lines = ["Missing required environment variables:"];
  for (const group of GROUPS) {
    if (group.level !== "required") continue;
    if (group.when && !group.when(env)) continue;
    const absent = group.vars.filter((name) => !env[name]);
    for (const name of absent) lines.push(`  - ${name}  (${group.hint})`);
  }
  for (const entry of result.invalid) lines.push(`  - ${entry}`);
  lines.push("See .env.example and run `npm run doctor` for live checks.");
  throw new Error(lines.join("\n"));
}
