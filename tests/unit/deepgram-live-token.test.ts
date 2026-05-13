import { describe, expect, it, vi } from "vitest";
import {
  grantDeepgramLiveToken,
  normalizeLiveTokenTtl,
} from "@/lib/deepgram/live-token";

describe("Deepgram live token helpers", () => {
  it("clamps token ttl to Deepgram's supported range", () => {
    expect(normalizeLiveTokenTtl("bad")).toBe(3600);
    expect(normalizeLiveTokenTtl(0)).toBe(1);
    expect(normalizeLiveTokenTtl(12.8)).toBe(12);
    expect(normalizeLiveTokenTtl(9000)).toBe(3600);
  });

  it("grants a token with a bounded ttl", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Token test-key",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({ ttl_seconds: 3600 });
      return Response.json({ access_token: "jwt", expires_in: 3600 });
    }) as typeof fetch;

    await expect(
      grantDeepgramLiveToken({
        apiKey: "test-key",
        ttlSeconds: 9000,
        fetchImpl,
      })
    ).resolves.toEqual({ accessToken: "jwt", expiresIn: 3600 });
  });
});
