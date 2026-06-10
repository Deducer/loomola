// scripts/doctor.ts — `npm run doctor`
// Live preflight: verifies each configured service actually works, with one
// ✓/✗/⚠ line per check. Exit 1 if any required check fails.
import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { checkEnv } from "../src/lib/env-check";
import { getR2Client, r2BucketName } from "../src/lib/r2/client";
import { resolveStorageEndpoint } from "../src/lib/r2/endpoint";

// Same loader shape as scripts/migrate.ts — doctor must work before deps
// like dotenv exist in the runtime image.
function loadLocalEnvIfNeeded() {
  if (process.env.DATABASE_URL) return;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
    }
    if (process.env.DATABASE_URL) return;
  }
}

type Status = "ok" | "fail" | "warn" | "skip";
const results: { name: string; status: Status; detail: string }[] = [];
function record(name: string, status: Status, detail = "") {
  results.push({ name, status, detail });
  const icon = { ok: "✓", fail: "✗", warn: "⚠", skip: "–" }[status];
  console.log(`${icon} ${name.padEnd(28)} ${detail}`);
}

async function checkDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return record("Postgres", "fail", "DATABASE_URL not set");
  const sql = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    await sql`select 1`;
    record("Postgres", "ok", "connected");
  } catch (e) {
    record("Postgres", "fail", (e as Error).message);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function checkStorage() {
  let endpointInfo = "";
  try {
    const cfg = resolveStorageEndpoint();
    endpointInfo = cfg.endpoint;
  } catch (e) {
    return record("Object storage", "fail", (e as Error).message);
  }
  try {
    const client = getR2Client();
    const bucket = r2BucketName();
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    const key = `doctor-probe-${Date.now()}.txt`;
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: "doctor" })
    );
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    record("Object storage", "ok", `${endpointInfo} bucket=${bucket} (write+delete verified)`);
  } catch (e) {
    record("Object storage", "fail", `${endpointInfo}: ${(e as Error).message}`);
  }
}

async function checkSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return record("Supabase", "fail", "SUPABASE_URL / SERVICE_ROLE_KEY not set");
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    record("Supabase", res.ok ? "ok" : "fail", `auth settings → ${res.status}`);
  } catch (e) {
    record("Supabase", "fail", (e as Error).message);
  }
}

async function checkDeepgram() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return record("Deepgram", "warn", "no key — transcription disabled");
  try {
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${key}` },
    });
    record("Deepgram", res.ok ? "ok" : "fail", `projects → ${res.status}`);
  } catch (e) {
    record("Deepgram", "fail", (e as Error).message);
  }
}

async function checkLlm() {
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return record("LLM (openrouter)", "warn", "no key — AI features disabled");
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    }).catch((e) => e as Error);
    if (res instanceof Error) return record("LLM (openrouter)", "fail", res.message);
    return record("LLM (openrouter)", res.ok ? "ok" : "fail", `models → ${res.status}`);
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return record("LLM (anthropic)", "warn", "no key — AI features disabled");
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  }).catch((e) => e as Error);
  if (res instanceof Error) return record("LLM (anthropic)", "fail", res.message);
  record("LLM (anthropic)", res.ok ? "ok" : "fail", `models → ${res.status}`);
}

async function checkOpenAi() {
  if (process.env.ENABLE_GRANOLA !== "true")
    return record("OpenAI embeddings", "skip", "ENABLE_GRANOLA is not true");
  const key = process.env.OPENAI_API_KEY;
  if (!key) return record("OpenAI embeddings", "fail", "required when ENABLE_GRANOLA=true");
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  }).catch((e) => e as Error);
  if (res instanceof Error) return record("OpenAI embeddings", "fail", res.message);
  record("OpenAI embeddings", res.ok ? "ok" : "fail", `models → ${res.status}`);
}

function checkAppUrl() {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!url) return record("App URL", "fail", "NEXT_PUBLIC_APP_URL not set");
  if (url.startsWith("http://localhost") || url.startsWith("http://127.")) {
    const provider = process.env.TRANSCRIBE_PROVIDER ?? "deepgram";
    if (provider === "deepgram") {
      return record(
        "App URL",
        "warn",
        `${url} — Deepgram callbacks cannot reach localhost; use a public HTTPS URL (deploy/ngrok/tunnel) for transcription`
      );
    }
  }
  record("App URL", "ok", url);
}

function checkMail() {
  const configured = Boolean(
    process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN && process.env.MAIL_FROM_ADDRESS
  );
  record(
    "Email (Mailgun)",
    configured ? "ok" : "warn",
    configured ? `domain=${process.env.MAILGUN_DOMAIN}` : "not configured — notifications skipped"
  );
}

async function main() {
  loadLocalEnvIfNeeded();
  console.log("Loomola doctor\n");
  const env = checkEnv();
  if (env.missing.length > 0)
    record("Env contract", "fail", `missing required: ${env.missing.join(", ")}`);
  else if (env.warnings.length > 0)
    record("Env contract", "warn", `missing optional: ${env.warnings.join(", ")}`);
  else record("Env contract", "ok", "all configured");

  await checkDb();
  await checkStorage();
  await checkSupabase();
  await checkDeepgram();
  await checkLlm();
  await checkOpenAi();
  checkMail();
  checkAppUrl();

  const failed = results.filter((r) => r.status === "fail");
  console.log(
    failed.length === 0
      ? "\nAll checks passed. ⚠ items degrade gracefully."
      : `\n${failed.length} check(s) failed — fix these before going further.`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("doctor crashed:", e);
  process.exit(1);
});
