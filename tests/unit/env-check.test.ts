import { describe, expect, it } from "vitest";
import { assertCoreEnv, checkEnv } from "@/lib/env-check";

const FULL: Record<string, string> = {
  DATABASE_URL: "postgresql://x",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_ANON_KEY: "k",
  SUPABASE_SERVICE_ROLE_KEY: "k",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  VIEW_UNLOCK_SECRET: "s",
  VISITOR_HASH_SALT: "s",
  R2_ACCOUNT_ID: "a",
  R2_ACCESS_KEY_ID: "a",
  R2_SECRET_ACCESS_KEY: "a",
  R2_BUCKET_NAME: "b",
  DEEPGRAM_API_KEY: "d",
  DEEPGRAM_CALLBACK_SIGNING_SECRET: "d",
  ANTHROPIC_API_KEY: "a",
  MAILGUN_API_KEY: "m",
  MAILGUN_DOMAIN: "m",
  MAIL_FROM_ADDRESS: "m",
};

describe("checkEnv", () => {
  it("is ok with the full set", () => {
    const r = checkEnv(FULL);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("missing Mailgun is a warning, not a failure", () => {
    const { MAILGUN_API_KEY: _1, MAILGUN_DOMAIN: _2, MAIL_FROM_ADDRESS: _3, ...rest } = FULL;
    const r = checkEnv(rest);
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("MAILGUN_API_KEY");
  });

  it("missing DATABASE_URL fails", () => {
    const { DATABASE_URL: _1, ...rest } = FULL;
    const r = checkEnv(rest);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("DATABASE_URL");
  });

  it("R2_ACCOUNT_ID is not required when S3_ENDPOINT is set", () => {
    const { R2_ACCOUNT_ID: _1, ...rest } = FULL;
    expect(checkEnv(rest).missing).toContain("R2_ACCOUNT_ID");
    expect(checkEnv({ ...rest, S3_ENDPOINT: "http://minio:9000" }).ok).toBe(true);
  });

  it("OPENAI_API_KEY required only when ENABLE_GRANOLA=true", () => {
    expect(checkEnv(FULL).ok).toBe(true);
    const r = checkEnv({ ...FULL, ENABLE_GRANOLA: "true" });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("OPENAI_API_KEY");
  });

  it("openrouter provider swaps the AI warning to OPENROUTER_API_KEY", () => {
    const { ANTHROPIC_API_KEY: _1, ...rest } = FULL;
    expect(checkEnv(rest).warnings).toContain("ANTHROPIC_API_KEY");
    const r = checkEnv({ ...rest, LLM_PROVIDER: "openrouter" });
    expect(r.warnings).toContain("OPENROUTER_API_KEY");
    expect(r.warnings).not.toContain("ANTHROPIC_API_KEY");
  });
});

describe("assertCoreEnv", () => {
  it("throws a readable multi-line message listing each missing var", () => {
    const { DATABASE_URL: _1, SUPABASE_URL: _2, ...rest } = FULL;
    expect(() => assertCoreEnv(rest)).toThrow(/DATABASE_URL[\s\S]*SUPABASE_URL/);
  });
  it("does not throw when only recommended vars are missing", () => {
    const { ANTHROPIC_API_KEY: _1, MAILGUN_API_KEY: _2, ...rest } = FULL;
    expect(() => assertCoreEnv(rest)).not.toThrow();
  });
});
