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
