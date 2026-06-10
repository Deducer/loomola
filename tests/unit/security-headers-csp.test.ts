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
