import { afterEach, describe, expect, it } from "vitest";
import { hasIntegrationToken } from "@/lib/integration-auth";

const originalToken = process.env.INTEGRATION_API_TOKEN;

describe("integration bearer token auth", () => {
  afterEach(() => {
    process.env.INTEGRATION_API_TOKEN = originalToken;
  });

  it("accepts the configured integration token", () => {
    process.env.INTEGRATION_API_TOKEN = "token-123";
    const request = new Request("https://loom.test/api/export", {
      headers: { authorization: "Bearer token-123" },
    });

    expect(hasIntegrationToken(request)).toBe(true);
  });

  it("rejects missing or wrong tokens", () => {
    process.env.INTEGRATION_API_TOKEN = "token-123";

    expect(hasIntegrationToken(new Request("https://loom.test/api/export"))).toBe(
      false
    );
    expect(
      hasIntegrationToken(
        new Request("https://loom.test/api/export", {
          headers: { authorization: "Bearer wrong" },
        })
      )
    ).toBe(false);
  });
});
