# OSS Readiness Phase 1 — One-Command Self-Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stranger can self-host Loomola without Doppler, without Cloudflare R2 specifically, and without env-var archaeology — `docker compose up` plus a Supabase project gets them running; `npm run doctor` tells them exactly what's broken when it isn't.

**Architecture:** Storage endpoint resolution becomes a pure module consumed by both the S3 clients and the CSP builder (two clients: server-ops vs presigning, because compose runs MinIO at a container-internal hostname while browsers hit `localhost:9000`). The env contract becomes declarative groups (required core vs per-feature recommended). Doppler becomes an optional wrapper via a shell entrypoint. Repo hygiene items from spec Phase 6 that the spec allows to land early ride along.

**Tech Stack:** Next.js 15, @aws-sdk/client-s3, Vitest, Docker Compose, MinIO, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-09-open-source-readiness-design.md` (Phase 1 + early Phase 6 items)

**⚠️ Working-tree warning:** The repo has unrelated uncommitted changes (transcript-export work: `src/lib/recordings/transcript-export.ts`, `src/app/api/recordings/[id]/transcript.*`, modified `.env.example`/READMEs/edit page). NEVER `git add -A` or `git add .`. Stage only the files named in each task's commit step. If `.env.example` or `README.md` need edits in a task, stage them with `git add -p` semantics in mind — the diffs you add must be only yours; if you find pre-existing unstaged hunks in those files, include them untouched and mention it in the commit you make (they are doc-only).

---

### Task 1: Storage endpoint resolution module

**Files:**
- Create: `src/lib/r2/endpoint.ts`
- Test: `tests/unit/storage-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/storage-endpoint.test.ts
import { describe, expect, it } from "vitest";
import {
  resolveStorageEndpoint,
  storageCspOrigins,
} from "@/lib/r2/endpoint";

describe("resolveStorageEndpoint", () => {
  it("constructs the R2 endpoint from R2_ACCOUNT_ID when S3_ENDPOINT is unset", () => {
    const cfg = resolveStorageEndpoint({ R2_ACCOUNT_ID: "abc123" });
    expect(cfg.endpoint).toBe("https://abc123.r2.cloudflarestorage.com");
    expect(cfg.publicEndpoint).toBe("https://abc123.r2.cloudflarestorage.com");
    expect(cfg.forcePathStyle).toBe(false);
    expect(cfg.cspOrigins).toEqual(["https://*.r2.cloudflarestorage.com"]);
  });

  it("uses S3_ENDPOINT verbatim with path-style default true", () => {
    const cfg = resolveStorageEndpoint({ S3_ENDPOINT: "http://minio:9000" });
    expect(cfg.endpoint).toBe("http://minio:9000");
    expect(cfg.publicEndpoint).toBe("http://minio:9000");
    expect(cfg.forcePathStyle).toBe(true);
    expect(cfg.cspOrigins).toEqual(["http://minio:9000"]);
  });

  it("S3_ENDPOINT wins over R2_ACCOUNT_ID when both are set", () => {
    const cfg = resolveStorageEndpoint({
      S3_ENDPOINT: "https://s3.us-east-1.amazonaws.com",
      S3_FORCE_PATH_STYLE: "false",
      R2_ACCOUNT_ID: "abc123",
    });
    expect(cfg.endpoint).toBe("https://s3.us-east-1.amazonaws.com");
    expect(cfg.forcePathStyle).toBe(false);
  });

  it("separates public endpoint for presigning when S3_PUBLIC_ENDPOINT is set", () => {
    const cfg = resolveStorageEndpoint({
      S3_ENDPOINT: "http://minio:9000",
      S3_PUBLIC_ENDPOINT: "http://localhost:9000",
    });
    expect(cfg.endpoint).toBe("http://minio:9000");
    expect(cfg.publicEndpoint).toBe("http://localhost:9000");
    // CSP must allow what the BROWSER talks to, not the internal hostname.
    expect(cfg.cspOrigins).toEqual(["http://localhost:9000"]);
  });

  it("throws a setup-hint error when neither S3_ENDPOINT nor R2_ACCOUNT_ID is set", () => {
    expect(() => resolveStorageEndpoint({})).toThrow(/S3_ENDPOINT|R2_ACCOUNT_ID/);
  });
});

describe("storageCspOrigins", () => {
  it("never throws — falls back to the R2 wildcard when storage is unconfigured", () => {
    expect(storageCspOrigins({})).toEqual(["https://*.r2.cloudflarestorage.com"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/storage-endpoint.test.ts`
Expected: FAIL — cannot resolve `@/lib/r2/endpoint`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/r2/endpoint.ts
//
// Pure env → storage-endpoint resolution. Deliberately dependency-free so
// the CSP builder (which runs in middleware) can import it without dragging
// in the AWS SDK.

export interface StorageEndpointConfig {
  /** Endpoint the SERVER talks to (inside docker networks this can be an
   * internal hostname like http://minio:9000). */
  endpoint: string;
  /** Endpoint baked into presigned URLs — must be reachable from the BROWSER.
   * Same as `endpoint` unless S3_PUBLIC_ENDPOINT overrides it. */
  publicEndpoint: string;
  forcePathStyle: boolean;
  /** Origin(s) to allow in CSP media-src / connect-src. */
  cspOrigins: string[];
}

type Env = Record<string, string | undefined>;

export function resolveStorageEndpoint(
  env: Env = process.env
): StorageEndpointConfig {
  const explicit = env.S3_ENDPOINT;
  if (explicit) {
    const publicEndpoint = env.S3_PUBLIC_ENDPOINT || explicit;
    return {
      endpoint: explicit,
      publicEndpoint,
      // MinIO requires path-style; opting out is for AWS-style vhost buckets.
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
      cspOrigins: [new URL(publicEndpoint).origin],
    };
  }

  const accountId = env.R2_ACCOUNT_ID;
  if (!accountId) {
    throw new Error(
      "Storage is not configured. Set S3_ENDPOINT (any S3-compatible store, e.g. MinIO) or R2_ACCOUNT_ID (Cloudflare R2)."
    );
  }
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    endpoint,
    publicEndpoint: endpoint,
    forcePathStyle: false,
    cspOrigins: ["https://*.r2.cloudflarestorage.com"],
  };
}

/** Non-throwing variant for the CSP builder: an unconfigured dev box should
 * still serve pages, just with the historical R2 wildcard. */
export function storageCspOrigins(env: Env = process.env): string[] {
  try {
    return resolveStorageEndpoint(env).cspOrigins;
  } catch {
    return ["https://*.r2.cloudflarestorage.com"];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/storage-endpoint.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/r2/endpoint.ts tests/unit/storage-endpoint.test.ts
git commit -m "Add S3-compatible storage endpoint resolution"
```

---

### Task 2: Wire endpoint resolution into the S3 clients + presign call sites

**Files:**
- Modify: `src/lib/r2/client.ts` (whole file)
- Modify: `src/lib/r2/presigned-get.ts:15` (`getR2Client()` → `getPresignClient()`)
- Modify: `src/lib/r2/multipart.ts:34` (`getR2Client()` → `getPresignClient()` in `presignUploadPart` ONLY)

`createMultipartUpload` / `completeMultipartUpload` / `abortMultipartUpload` / `upload-bytes.ts` are server-side operations and stay on `getR2Client()`. Only the two functions whose output URL a **browser** fetches switch to the presign client.

- [ ] **Step 1: Replace `src/lib/r2/client.ts` with**

```typescript
import { S3Client } from "@aws-sdk/client-s3";
import { resolveStorageEndpoint } from "./endpoint";

let opsClient: S3Client | null = null;
let presignClient: S3Client | null = null;

function credentials() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing storage credentials (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)"
    );
  }
  return { accessKeyId, secretAccessKey };
}

/**
 * Cached S3 client for server-side operations against the configured
 * S3-compatible store (Cloudflare R2 by default; MinIO/AWS via S3_ENDPOINT).
 * Name kept from the R2-only era — ~30 call sites import it.
 */
export function getR2Client(): S3Client {
  if (opsClient) return opsClient;
  const cfg = resolveStorageEndpoint();
  opsClient = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: credentials(),
  });
  return opsClient;
}

/**
 * Client used ONLY to presign URLs that a browser will fetch. Differs from
 * getR2Client when S3_PUBLIC_ENDPOINT is set (docker-compose: the server
 * reaches MinIO at http://minio:9000 but the browser at http://localhost:9000;
 * the signature covers the host, so signing must happen against the public
 * endpoint).
 */
export function getPresignClient(): S3Client {
  if (presignClient) return presignClient;
  const cfg = resolveStorageEndpoint();
  if (cfg.publicEndpoint === cfg.endpoint) {
    presignClient = getR2Client();
    return presignClient;
  }
  presignClient = new S3Client({
    region: "auto",
    endpoint: cfg.publicEndpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: credentials(),
  });
  return presignClient;
}

export function r2BucketName(): string {
  const name = process.env.R2_BUCKET_NAME;
  if (!name) throw new Error("R2_BUCKET_NAME is not set");
  return name;
}
```

- [ ] **Step 2: Switch the two presign call sites**

In `src/lib/r2/presigned-get.ts`: change the import to `import { getPresignClient, r2BucketName } from "./client";` and line 15 to `const client = getPresignClient();`.

In `src/lib/r2/multipart.ts`: add `getPresignClient` to the import from `./client`, and in `presignUploadPart` (line 34) change `const client = getR2Client();` to `const client = getPresignClient();`. Leave the other three functions untouched.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run test`
Expected: clean typecheck; full unit suite passes (no behavior change for R2 setups — same endpoint, same client).

- [ ] **Step 4: Commit**

```bash
git add src/lib/r2/client.ts src/lib/r2/presigned-get.ts src/lib/r2/multipart.ts
git commit -m "Support generic S3 endpoints with split ops/presign clients"
```

---

### Task 3: Derive CSP origins from configuration

**Files:**
- Modify: `src/lib/security/headers.ts`
- Test: `tests/unit/security-headers-csp.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/security-headers-csp.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCSP } from "@/lib/security/headers";

const SAVED = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("buildCSP", () => {
  beforeEach(() => {
    setEnv({
      S3_ENDPOINT: undefined,
      S3_PUBLIC_ENDPOINT: undefined,
      R2_ACCOUNT_ID: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
    });
  });
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("keeps the R2 wildcard when no explicit S3 endpoint is configured", () => {
    const csp = buildCSP({});
    expect(csp).toContain("media-src 'self' https://*.r2.cloudflarestorage.com blob:");
    expect(csp).toContain("https://*.r2.cloudflarestorage.com");
  });

  it("allows the PUBLIC storage origin when S3_PUBLIC_ENDPOINT is set", () => {
    setEnv({
      S3_ENDPOINT: "http://minio:9000",
      S3_PUBLIC_ENDPOINT: "http://localhost:9000",
    });
    const csp = buildCSP({});
    expect(csp).toContain("media-src 'self' http://localhost:9000 blob:");
    expect(csp).not.toContain("minio:9000");
  });

  it("derives frame-src from NEXT_PUBLIC_APP_URL instead of a hardcoded domain", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://video.example.com" });
    const csp = buildCSP({});
    expect(csp).toContain("frame-src 'self' https://video.example.com");
    expect(csp).not.toContain("dissonance.cloud");
  });

  it("omits upgrade-insecure-requests for http app origins (local/MinIO setups)", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
    expect(buildCSP({})).not.toContain("upgrade-insecure-requests");
    setEnv({ NEXT_PUBLIC_APP_URL: "https://video.example.com" });
    expect(buildCSP({})).toContain("upgrade-insecure-requests");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/security-headers-csp.test.ts`
Expected: FAIL — `buildCSP` is not exported.

- [ ] **Step 3: Modify `src/lib/security/headers.ts`**

Add the import at the top:

```typescript
import { storageCspOrigins } from "@/lib/r2/endpoint";
```

Replace the `buildCSP` function (keep everything else) with — note it becomes `export function`:

```typescript
function appOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCSP(opts: SecurityHeaderOptions): string {
  const scriptSrc = [
    "script-src",
    "'self'",
    "'unsafe-inline'",
    ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  ].join(" ");
  const storage = storageCspOrigins().join(" ");
  const app = appOrigin();
  // upgrade-insecure-requests would rewrite http://localhost:9000 (MinIO) and
  // http LAN deploys to https and break them; only emit it when the instance
  // itself is served over https.
  const httpsApp = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
  const directives = [
    "default-src 'self'",
    // 'unsafe-inline' on script-src is required by the share-page theme
    // bootstrap (inline <script> that flips html.dark before paint to avoid
    // theme flash) and various small Next.js-emitted inline bootstraps.
    // Next's development runtime also needs 'unsafe-eval'; keep that out of
    // production CSP.
    // Tightening to a nonce-based CSP is tracked as a follow-up.
    scriptSrc,
    // 'unsafe-inline' on style-src is required by Tailwind v4 runtime + Plyr
    // inline styles + brand custom-color injection.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https: data: blob:",
    `media-src 'self' ${storage} blob:`,
    ["connect-src 'self'", "https://*.supabase.co", "wss://*.supabase.co", storage].join(" "),
    "worker-src 'self' blob:",
    app && app !== "null" ? `frame-src 'self' ${app}` : "frame-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(httpsApp ? ["upgrade-insecure-requests"] : []),
  ];
  if (!opts.allowFraming) {
    directives.push("frame-ancestors 'self'");
  }
  return directives.join("; ");
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/security-headers-csp.test.ts && npm run test`
Expected: new tests PASS, full suite still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/security/headers.ts tests/unit/security-headers-csp.test.ts
git commit -m "Derive CSP storage and frame origins from configuration"
```

---

### Task 4: Declarative env contract with fail-fast core

**Files:**
- Modify: `src/lib/env-check.ts` (whole file)
- Modify: `src/lib/boot-log.ts` (log warnings too)
- Modify: `scripts/migrate.ts` (assert core env in production)
- Test: `tests/unit/env-check.test.ts`

Contract decision (refines spec 1.4): only **core** vars block boot — DB/Supabase/storage/secrets/app URL. Transcription, AI, and email are *recommended*: the app boots and serves UI without them, the boot log warns loudly, `doctor` flags them, and point-of-use errors stay clear. This keeps "UI-only local test" viable per the README quickstart while production misconfigs fail at container start (migrate runs first).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/env-check.test.ts
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
    const { MAILGUN_API_KEY, MAILGUN_DOMAIN, MAIL_FROM_ADDRESS, ...rest } = FULL;
    const r = checkEnv(rest);
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("MAILGUN_API_KEY");
  });

  it("missing DATABASE_URL fails", () => {
    const { DATABASE_URL, ...rest } = FULL;
    const r = checkEnv(rest);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("DATABASE_URL");
  });

  it("R2_ACCOUNT_ID is not required when S3_ENDPOINT is set", () => {
    const { R2_ACCOUNT_ID, ...rest } = FULL;
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
    const { ANTHROPIC_API_KEY, ...rest } = FULL;
    expect(checkEnv(rest).warnings).toContain("ANTHROPIC_API_KEY");
    const r = checkEnv({ ...rest, LLM_PROVIDER: "openrouter" });
    expect(r.warnings).toContain("OPENROUTER_API_KEY");
    expect(r.warnings).not.toContain("ANTHROPIC_API_KEY");
  });
});

describe("assertCoreEnv", () => {
  it("throws a readable multi-line message listing each missing var", () => {
    const { DATABASE_URL, SUPABASE_URL, ...rest } = FULL;
    expect(() => assertCoreEnv(rest)).toThrow(/DATABASE_URL[\s\S]*SUPABASE_URL/);
  });
  it("does not throw when only recommended vars are missing", () => {
    const { ANTHROPIC_API_KEY, MAILGUN_API_KEY, ...rest } = FULL;
    expect(() => assertCoreEnv(rest)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/env-check.test.ts`
Expected: FAIL — `checkEnv` doesn't accept an env argument / `assertCoreEnv` missing.

- [ ] **Step 3: Replace `src/lib/env-check.ts` with**

```typescript
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
    when: (env) => (env.TRANSCRIBE_PROVIDER ?? "deepgram") === "deepgram",
    hint: "Without Deepgram, recordings upload but never transcribe.",
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
}

export function checkEnv(env: Env = process.env): EnvCheckResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  for (const group of GROUPS) {
    if (group.when && !group.when(env)) continue;
    const absent = group.vars.filter((name) => !env[name]);
    if (group.level === "required") missing.push(...absent);
    else warnings.push(...absent);
  }
  return { ok: missing.length === 0, missing, warnings };
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
  lines.push("See .env.example and run `npm run doctor` for live checks.");
  throw new Error(lines.join("\n"));
}
```

- [ ] **Step 4: Update `src/lib/boot-log.ts`**

Replace the `missingTag` line (line 20) and the `console.log` with:

```typescript
    const missingTag = env.ok ? "" : ` missingEnv=[${env.missing.join(",")}]`;
    const warnTag =
      env.warnings.length > 0 ? ` degradedEnv=[${env.warnings.join(",")}]` : "";
    console.log(
      `[boot] app=${app} db=${host} r2=${bucket} mailgun=${mg}${missingTag}${warnTag}`
    );
```

- [ ] **Step 5: Add the production assert to `scripts/migrate.ts`**

Add the import (esbuild bundles this relative path fine):

```typescript
import { assertCoreEnv } from "../src/lib/env-check";
```

In `main()`, immediately after `loadLocalEnvIfNeeded();` add:

```typescript
  // Fail fast in containers: one readable list beats lazy crashes. Dev stays
  // permissive so `npm run db:migrate` works during incremental setup.
  if (process.env.NODE_ENV === "production") {
    assertCoreEnv();
  }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/unit/env-check.test.ts && npm run typecheck && npm run test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/env-check.ts src/lib/boot-log.ts scripts/migrate.ts tests/unit/env-check.test.ts
git commit -m "Declarative env contract: fail fast on core, warn on degraded"
```

---

### Task 5: Make email genuinely optional

**Files:**
- Modify: `src/lib/mail/mailgun.ts`
- Modify: `src/app/api/contact/route.ts` (early 503 + de-instanced message)
- Test: `tests/unit/mail-optional.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/mail-optional.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmailConfigured, sendEmail } from "@/lib/mail/mailgun";

const SAVED = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllGlobals();
});

describe("optional email", () => {
  it("isEmailConfigured is false when any Mailgun var is missing", () => {
    delete process.env.MAILGUN_API_KEY;
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    process.env.MAIL_FROM_ADDRESS = "x@example.com";
    expect(isEmailConfigured()).toBe(false);
  });

  it("sendEmail no-ops (no fetch, no throw) when unconfigured", async () => {
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    delete process.env.MAIL_FROM_ADDRESS;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      sendEmail({ to: "a@b.c", subject: "s", text: "t", html: "<p>t</p>" })
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mail-optional.test.ts`
Expected: FAIL — `isEmailConfigured` not exported; `sendEmail` throws.

- [ ] **Step 3: Modify `src/lib/mail/mailgun.ts`**

Add above `sendEmail`:

```typescript
export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.MAILGUN_API_KEY &&
      process.env.MAILGUN_DOMAIN &&
      process.env.MAIL_FROM_ADDRESS
  );
}
```

At the top of `sendEmail`, before the `envOrThrow` calls, add:

```typescript
  if (!isEmailConfigured()) {
    console.log(`[mail] email not configured; skipping send: "${subject}"`);
    return;
  }
```

- [ ] **Step 4: Modify `src/app/api/contact/route.ts`**

Add `isEmailConfigured` to the existing import from `@/lib/mail/mailgun` (it already imports `sendEmail`). At the start of the POST handler (after rate limiting / validation, before building the email), add:

```typescript
  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "This instance has no email configured, so the contact form is disabled." },
      { status: 503 }
    );
  }
```

And replace the Ian-specific catch-block response:

```typescript
      { error: "Send failed; please DM @theiancross on X." },
```

with:

```typescript
      { error: "Send failed; please try again later." },
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/mail-optional.test.ts && npm run test && npm run typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mail/mailgun.ts src/app/api/contact/route.ts tests/unit/mail-optional.test.ts
git commit -m "Make email optional: skip sends and disable contact form when unconfigured"
```

---

### Task 6: `npm run doctor` — live connectivity checks

**Files:**
- Create: `scripts/doctor.ts`
- Modify: `package.json` (add script)

No unit test — this script is itself a test harness; its checks hit live services. Manual verification step below.

- [ ] **Step 1: Create `scripts/doctor.ts`**

```typescript
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
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts, after `"db:migrate"`:

```json
    "doctor": "tsx scripts/doctor.ts",
```

- [ ] **Step 3: Verify manually**

Run: `npm run doctor`
Expected on Ian's machine (full `.env.local`): all ✓ except possibly the App URL ⚠ for localhost. Then `R2_ACCOUNT_ID= DATABASE_URL=wrong npm run doctor` → ✗ lines with hints, exit 1. Run `npm run typecheck` (doctor.ts is covered by tsconfig include — if `tsc` complains about scripts/, confirm `scripts/migrate.ts` is type-checked today; mirror whatever treatment it gets).

- [ ] **Step 4: Commit**

```bash
git add scripts/doctor.ts package.json
git commit -m "Add npm run doctor: live preflight for every external service"
```

---

### Task 7: Doppler-optional container entrypoint

**Files:**
- Create: `docker-entrypoint.sh`
- Modify: `Dockerfile:64` (ENTRYPOINT)

- [ ] **Step 1: Create `docker-entrypoint.sh`**

```sh
#!/bin/sh
# With DOPPLER_TOKEN set (Ian's Coolify deploy), wrap the command in
# `doppler run` so secrets are injected at boot. Without it (docker-compose /
# plain `docker run --env-file`), exec directly — env vars come from the host.
set -e
if [ -n "$DOPPLER_TOKEN" ]; then
  exec doppler run -- "$@"
fi
exec "$@"
```

- [ ] **Step 2: Update the Dockerfile**

In the runtime stage, after the `COPY --from=build /app/scripts/migrate.cjs ./scripts/migrate.cjs` line, add:

```dockerfile
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
```

Replace:

```dockerfile
ENTRYPOINT ["doppler", "run", "--"]
```

with:

```dockerfile
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

CMD stays exactly as-is.

- [ ] **Step 3: Verify the image builds and the entrypoint branches**

Run:
```bash
docker build -t loomola-test --build-arg NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder --build-arg NEXT_PUBLIC_APP_URL=http://localhost:3000 .
docker run --rm loomola-test sh -c 'echo entrypoint-direct-ok'
docker run --rm -e DOPPLER_TOKEN=invalid loomola-test sh -c 'echo should-not-print' ; echo "doppler branch exit: $?"
```
Expected: build succeeds; first run prints `entrypoint-direct-ok`; second run fails inside doppler auth (non-zero exit) — proving the branch engages.

- [ ] **Step 4: Commit**

```bash
git add docker-entrypoint.sh Dockerfile
git commit -m "Make Doppler optional via shell entrypoint"
```

---

### Task 8: docker-compose with MinIO

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.compose.example`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
# Self-host Loomola with bundled MinIO object storage.
#   cp .env.compose.example .env.compose   # fill in Supabase + API keys
#   docker compose up -d
# Postgres + auth come from your (free) Supabase project — see README.
# Using Cloudflare R2 instead of MinIO? Deploy the Dockerfile directly
# (Coolify/Render/fly) with R2_* vars; this compose file is the
# batteries-included local/single-box path.

services:
  app:
    build:
      context: .
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
        NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
    env_file: .env.compose
    environment:
      S3_ENDPOINT: http://minio:9000
      S3_PUBLIC_ENDPOINT: ${S3_PUBLIC_ENDPOINT:-http://localhost:9000}
      R2_ACCESS_KEY_ID: ${MINIO_ROOT_USER:-loomola}
      R2_SECRET_ACCESS_KEY: ${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD in .env.compose}
      R2_BUCKET_NAME: ${R2_BUCKET_NAME:-loomola}
    ports:
      - "3000:3000"
    depends_on:
      minio-init:
        condition: service_completed_successfully
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 40s

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-loomola}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD in .env.compose}
      # Browser uploads go straight to MinIO via presigned URLs; CORS must
      # allow the app origin AND expose ETag (multipart upload reads it).
      MINIO_API_CORS_ALLOW_ORIGIN: ${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 10

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-loomola}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD in .env.compose}
      BUCKET: ${R2_BUCKET_NAME:-loomola}
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 \"$$MINIO_ROOT_USER\" \"$$MINIO_ROOT_PASSWORD\" &&
      mc mb --ignore-existing local/$$BUCKET &&
      echo bucket ready: $$BUCKET
      "

volumes:
  minio-data:
```

- [ ] **Step 2: Create `.env.compose.example`**

```bash
# Copy to .env.compose and fill in. Used by `docker compose up`.
# Storage (MinIO) is bundled — you do NOT need Cloudflare R2 here.
# You DO need a free Supabase project: https://supabase.com
#   (it provides Postgres + auth; see README "Create Service Accounts")

# --- Supabase (required) ---
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
DATABASE_URL=postgresql://postgres.xxxxxxxxxxxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require

# --- App (required) ---
# For a public deploy set your real https origin; transcription callbacks
# need a publicly reachable URL.
NEXT_PUBLIC_APP_URL=http://localhost:3000
VIEW_UNLOCK_SECRET=replace-with-openssl-rand-hex-32
VISITOR_HASH_SALT=replace-with-openssl-rand-hex-32

# --- MinIO (bundled storage) ---
MINIO_ROOT_USER=loomola
MINIO_ROOT_PASSWORD=replace-with-openssl-rand-hex-32
R2_BUCKET_NAME=loomola
# If browsers reach MinIO somewhere other than localhost:9000 (e.g. a VPS
# with a reverse proxy), set the public URL the browser should use:
# S3_PUBLIC_ENDPOINT=https://media.your-domain.com

# --- Transcription (recommended — recordings never transcribe without it) ---
DEEPGRAM_API_KEY=dg_...
DEEPGRAM_CALLBACK_SIGNING_SECRET=replace-with-openssl-rand-hex-32

# --- AI titles/summaries/chapters (recommended) ---
ANTHROPIC_API_KEY=sk-ant-...
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6

# --- Email notifications (optional) ---
MAILGUN_API_KEY=
MAILGUN_DOMAIN=
MAIL_FROM_ADDRESS=
CONTACT_INBOX=

# --- Granola audio notes product (optional) ---
ENABLE_GRANOLA=false
OPENAI_API_KEY=
INTEGRATION_API_TOKEN=replace-with-openssl-rand-hex-32
```

- [ ] **Step 3: Validate compose config parses**

Run: `docker compose --env-file .env.compose.example config --quiet; echo $?`
Expected: exits 1 complaining about `MINIO_ROOT_PASSWORD` placeholder being fine but `:?` guards — if so, run with a stub: `MINIO_ROOT_PASSWORD=x docker compose --env-file .env.compose.example config --quiet` → exit 0. (We want the `:?` guard to bite when unset; placeholder text counts as set, which is acceptable — doctor catches bad creds.)

- [ ] **Step 4: Full stack smoke (manual gate — requires Ian's Supabase/Deepgram keys in a real `.env.compose`)**

```bash
cp .env.compose.example .env.compose   # fill Supabase + Deepgram + Anthropic + a real MINIO_ROOT_PASSWORD
docker compose up -d --build
docker compose ps                       # all healthy
curl -fsS http://localhost:3000/api/health
```
Then in Chrome: sign in, record a 10-second clip, confirm upload completes (parts go to `http://localhost:9000`), playback works on the share page. **CORS/ETag check:** if upload fails on ETag, MinIO needs `MINIO_API_CORS_ALLOW_ORIGIN` to match the app origin exactly — fix and document rather than working around.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.compose.example
git commit -m "Add docker-compose with bundled MinIO storage"
```

---

### Task 9: De-instance the migration settings page

**Files:**
- Modify: `src/app/settings/migration/page.tsx:14-15`

(The contact route was de-instanced in Task 5.)

- [ ] **Step 1: Replace the fallback**

```typescript
  const serverUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://loom.dissonance.cloud";
```

becomes:

```typescript
  const serverUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck`

```bash
git add src/app/settings/migration/page.tsx
git commit -m "Migration page: derive server URL from app config"
```

---

### Task 10: Untrack internal-only content

**Files:**
- Delete from index (keep on disk): `docs/Granola UI Screenshots/`, `.claude/settings.local.json`
- Modify: `.gitignore`

- [ ] **Step 1: Untrack**

```bash
git rm -r --cached "docs/Granola UI Screenshots"
git rm --cached .claude/settings.local.json
```

- [ ] **Step 2: Append to `.gitignore`**

```gitignore
docs/Granola UI Screenshots/
.claude/settings.local.json
.env.compose
```

(`.env.compose` rides along here — it will hold real secrets for compose users.)

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "Untrack Granola reference screenshots and local agent settings"
```

Note: forward-only per spec — no history rewrite.

---

### Task 11: Community files

**Files:**
- Create: `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/setup_help.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 1: Create `CONTRIBUTING.md`**

```markdown
# Contributing to Loomola

Thanks for your interest. Loomola is a solo-maintained project that's used in production daily — contributions are welcome, but please read this first.

## Dev setup

Follow the README "Self-host Quickstart" — local dev needs Node 22, a Supabase project, and (for the full pipeline) Deepgram + Anthropic keys. `npm run doctor` verifies your setup.

```bash
npm install
npm run dev          # app at http://localhost:3000
npm run test         # unit tests (Vitest) — must pass
npm run typecheck    # strict TS — must pass
npm run lint         # ESLint
```

E2E tests (`npm run test:e2e`) need a running dev server plus `TEST_CREATOR_EMAIL` / `TEST_CREATOR_PASSWORD` in `.env.local`.

## Before opening a PR

- One change per PR. Small PRs get reviewed fast; sprawling ones don't.
- Unit tests for new logic. The suite is fast — run it.
- Match the existing style: CSS-var tokens (no ad-hoc hex colors), no premature abstraction, no speculative options.
- For features (vs fixes): open an issue first to check fit. The roadmap is opinionated.

## Areas where help is most welcome

- "This broke in my self-host setup" reports with reproduction details
- Loom/Granola import tooling
- Provider integrations behind the existing env-var abstractions (LLM, transcription, storage)

## Desktop app (macOS, `desktop/`)

Swift / SwiftUI, built with `desktop/scripts/install-local-app.sh`. Run `swift test` in `desktop/` before submitting.
```

- [ ] **Step 2: Create `SECURITY.md`**

```markdown
# Security Policy

## Reporting a vulnerability

Please do NOT open a public issue for security vulnerabilities.

Email the maintainer via the contact form at the live instance, or use
GitHub's private vulnerability reporting ("Report a vulnerability" under the
Security tab) on this repository.

You'll get an acknowledgment within a few days. Fixes for confirmed issues in
the web app ship quickly — it's deployed continuously.

## Scope

- Web app (`src/`), Chrome extension (`extension/`), macOS app (`desktop/`)
- Self-hosting misconfigurations are appreciated as reports too, especially
  anything the docs encourage that turns out to be unsafe.

## Supported versions

The `main` branch and the latest tagged release.
```

- [ ] **Step 3: Create `.github/ISSUE_TEMPLATE/bug_report.yml`**

```yaml
name: Bug report
description: Something broke in the product
labels: [bug]
body:
  - type: input
    id: surface
    attributes:
      label: Surface
      placeholder: web dashboard / share page / recorder / desktop app / extension
    validations:
      required: true
  - type: textarea
    id: what
    attributes:
      label: What happened, and what did you expect?
    validations:
      required: true
  - type: textarea
    id: repro
    attributes:
      label: Steps to reproduce
  - type: textarea
    id: env
    attributes:
      label: Environment
      description: Self-hosted (compose / Coolify / other)? Browser? macOS version (for desktop)?
```

- [ ] **Step 4: Create `.github/ISSUE_TEMPLATE/setup_help.yml`**

```yaml
name: Self-hosting setup help
description: Stuck getting your own instance running
labels: [setup]
body:
  - type: textarea
    id: doctor
    attributes:
      label: Output of `npm run doctor` (or `docker compose logs app | head -50`)
      render: text
    validations:
      required: true
  - type: input
    id: path
    attributes:
      label: Setup path
      placeholder: docker compose / Coolify / manual node
    validations:
      required: true
  - type: textarea
    id: stuck
    attributes:
      label: Where you got stuck
      description: Which README step, and what you saw instead of the expected result.
    validations:
      required: true
```

- [ ] **Step 5: Create `.github/ISSUE_TEMPLATE/feature_request.yml`**

```yaml
name: Feature request
description: Something Loom/Granola does that Loomola should, or a new idea
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem would this solve for you?
    validations:
      required: true
  - type: textarea
    id: shape
    attributes:
      label: What might it look like?
```

- [ ] **Step 6: Create `.github/ISSUE_TEMPLATE/config.yml`**

```yaml
blank_issues_enabled: true
```

- [ ] **Step 7: Create `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## What & why

## How I tested it

- [ ] `npm run test` passes
- [ ] `npm run typecheck` passes
- [ ] Manually verified: <what you clicked/ran>
```

- [ ] **Step 8: Commit**

```bash
git add CONTRIBUTING.md SECURITY.md .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md
git commit -m "Add community files: contributing, security policy, issue/PR templates"
```

---

### Task 12: ESLint + CI lint/build jobs

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json` (lint script + devDeps)
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Install ESLint**

```bash
npm install -D eslint eslint-config-next @eslint/eslintrc
```

- [ ] **Step 2: Create `eslint.config.mjs`**

```javascript
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "desktop/**",
      "extension/**",
      "migrate/**",
      "output/**",
      "test-results/**",
      "scripts/*.mjs",
    ],
  },
  {
    rules: {
      // The codebase predates lint; gate on errors, keep style opinions off.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react/no-unescaped-entities": "off",
    },
  },
];
```

- [ ] **Step 3: Update the lint script**

`package.json`: change `"lint": "next lint"` to `"lint": "eslint ."` (Next 15 deprecates `next lint`; direct eslint with the flat config is the supported path).

- [ ] **Step 4: Run and triage**

Run: `npm run lint`
Expected: likely a wave of findings on first run. Fix real errors (unused imports, etc.) where trivial; for noisy stylistic rules that fire broadly, set the specific rule to `"off"` in `eslint.config.mjs` with a one-line comment — the goal is a **meaningful zero-error baseline**, not a mass rewrite. Budget: if a rule fires >20 times it gets disabled with a comment, not fixed file-by-file.

- [ ] **Step 5: Extend `.github/workflows/ci.yml`**

Read the existing file first; add lint to the existing test job's steps (after typecheck):

```yaml
      - run: npm run lint
```

And add a build job alongside the existing job (same `runs-on`, same checkout/setup-node/npm ci steps as the current job):

```yaml
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder-anon-key
          NEXT_PUBLIC_APP_URL: http://localhost:3000
```

If `next build` fails on the placeholder Supabase values (e.g., a page eagerly constructs a client at build time), note the failing page and add lazy construction there rather than weakening the build job — that exact failure is what bites self-hosters with wrong build args.

- [ ] **Step 6: Verify locally**

Run: `npm run lint && NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder NEXT_PUBLIC_APP_URL=http://localhost:3000 npm run build`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add eslint.config.mjs package.json package-lock.json .github/workflows/ci.yml
git commit -m "Add ESLint flat config and CI lint+build jobs"
# plus any source files fixed during lint triage — stage them explicitly
```

---

### Task 13: README + .env.example updates for the new paths

**Files:**
- Modify: `README.md` (insert compose quickstart, doctor mention, storage flexibility)
- Modify: `.env.example` (document S3_ENDPOINT vars)

The full README rewrite (screenshots, restructure) is spec Phase 6. This task only makes the README *truthful* about what Phase 1 built.

- [ ] **Step 1: Insert a "Quickstart A: Docker Compose" section**

Immediately after the "Two choices up front:" block in the Self-host Quickstart, insert:

```markdown
### Quickstart A — Docker Compose (recommended)

Bundled MinIO for storage; you bring a free [Supabase](https://supabase.com) project (Postgres + auth) and a [Deepgram](https://deepgram.com) + [Anthropic](https://console.anthropic.com) key for the AI pipeline.

```bash
git clone https://github.com/Deducer/loomola.git
cd loomola
cp .env.compose.example .env.compose
# Fill in: Supabase URL/keys/DATABASE_URL, Deepgram, Anthropic,
# and a random MINIO_ROOT_PASSWORD (openssl rand -hex 32).
docker compose up -d --build
```

Open http://localhost:3000. Migrations run automatically at boot. To verify every service is wired correctly:

```bash
docker compose exec app node --version   # container is alive
npm install && npm run doctor            # live checks against your config
```

The manual path below (Quickstart B) gives you `npm run dev` for development.
```

Renumber/retitle the existing steps 1–4 under a `### Quickstart B — Manual (npm run dev)` heading. Also update the "If you do not want Doppler" paragraph in Production Deploy Notes to:

```markdown
The container no longer requires Doppler: with `DOPPLER_TOKEN` set it injects
secrets at boot (Ian's setup); without it, env vars pass through directly
(`docker compose` / `docker run --env-file`).
```

- [ ] **Step 2: Document the storage vars in `.env.example`**

Replace the `# Cloudflare R2` block header and add after `R2_BUCKET_NAME`:

```bash
# Object storage — Cloudflare R2 by default, or any S3-compatible store.
# For MinIO/AWS S3: set S3_ENDPOINT and leave R2_ACCOUNT_ID empty.
#   S3_ENDPOINT=http://localhost:9000        # what the SERVER connects to
#   S3_PUBLIC_ENDPOINT=http://localhost:9000 # what the BROWSER connects to (presigned URLs); defaults to S3_ENDPOINT
#   S3_FORCE_PATH_STYLE=true                 # default true when S3_ENDPOINT is set
S3_ENDPOINT=
S3_PUBLIC_ENDPOINT=
```

⚠️ `.env.example` and `README.md` have pre-existing unstaged hunks from the transcript-export work — include them as-is (doc-only) and note it in the commit message, or `git stash` selectively if cleaner. Do not discard them.

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "Document compose quickstart, doctor, and S3-compatible storage"
```

---

### Task 14: Phase verification gate

- [ ] **Step 1: Full local suite**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: all green.

- [ ] **Step 2: Container build + boot fail-fast proof**

```bash
docker build -t loomola-test --build-arg NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder --build-arg NEXT_PUBLIC_APP_URL=http://localhost:3000 .
docker run --rm loomola-test 2>&1 | head -20
```
Expected: container exits quickly with the readable "Missing required environment variables:" list from `assertCoreEnv` — fail-fast working as designed.

- [ ] **Step 3: Compose smoke** (manual gate with real keys — see Task 8 Step 4; required before the Abb session, not before merging)

- [ ] **Step 4: Push**

```bash
git push origin main
```
Then watch the Coolify deploy: Ian's prod must come up clean (Doppler branch of the entrypoint + unchanged R2 behavior). Verify `https://loom.dissonance.cloud/api/health` after deploy.

---

## Spec-coverage self-check

| Spec item | Task |
|---|---|
| 1.1 Doppler-optional container | 7 |
| 1.2 docker-compose + MinIO + healthcheck | 8 |
| 1.3 Generic S3 endpoint + CSP derivation | 1, 2, 3 |
| 1.4 Env contract + fail-fast + doctor | 4, 6 |
| 1.5 De-instance code | 5 (contact), 9 (migration page), 3 (CSP) |
| Phase 6 early: untrack files | 10 |
| Phase 6 early: community files | 11 |
| Phase 6 early: ESLint + CI build | 12 |
| Docs truthfulness | 13 |
