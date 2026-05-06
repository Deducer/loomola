import { describe, expect, it, mock } from "bun:test";
import { GranolaApiClient } from "../src/granola/api-client";
import { GranolaAuth } from "../src/granola/auth";

function fakeAuth(initialToken = "tok") {
  const auth = GranolaAuth.fromTokens({
    accessToken: initialToken,
    refreshToken: "ref",
    expiresAt: null,
  });
  // Stub refresh() to bump the token without a network call
  (auth as unknown as { refresh: () => Promise<void> }).refresh = async () => {
    (auth as unknown as { tokens: { accessToken: string } }).tokens.accessToken =
      "tok-2";
  };
  return auth;
}

describe("GranolaApiClient", () => {
  it("attaches Bearer token + JSON body", async () => {
    const fetch = mock(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer tok");
      expect(headers["content-type"]).toBe("application/json");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new GranolaApiClient(fakeAuth(), {
      fetch: fetch as never,
    });
    const res = await client.getMe();
    expect(res).toEqual({ ok: true } as never);
    expect(fetch).toHaveBeenCalled();
  });

  it("retries once after 401 with refreshed token", async () => {
    let calls = 0;
    const fetch = mock(async (_url: string, init: RequestInit) => {
      calls++;
      if (calls === 1) return new Response("nope", { status: 401 });
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer tok-2");
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    });
    const client = new GranolaApiClient(fakeAuth(), {
      fetch: fetch as never,
    });
    const r = await client.getMe();
    expect(r).toEqual({ id: "x" });
    expect(calls).toBe(2);
  });

  it("throws GranolaApiError after a second 401", async () => {
    const fetch = mock(async () => new Response("nope", { status: 401 }));
    const client = new GranolaApiClient(fakeAuth(), {
      fetch: fetch as never,
    });
    await expect(client.getMe()).rejects.toThrow(/granola/i);
  });

  it("getDocumentTranscript returns null on 404", async () => {
    const fetch = mock(async () => new Response("not found", { status: 404 }));
    const client = new GranolaApiClient(fakeAuth(), {
      fetch: fetch as never,
    });
    expect(await client.getDocumentTranscript("doc-1")).toBeNull();
  });

  it("rate-limits to ~5 req/s sustained", async () => {
    const fetch = mock(
      async () => new Response("{}", { status: 200 })
    );
    const client = new GranolaApiClient(fakeAuth(), {
      fetch: fetch as never,
      rateLimitTokensPerSec: 5,
      rateLimitBurst: 5,
    });
    const start = Date.now();
    await Promise.all(Array.from({ length: 10 }, () => client.getMe()));
    const elapsed = Date.now() - start;
    // 10 requests, burst 5, refill 5/s → next 5 wait ~1s
    expect(elapsed).toBeGreaterThanOrEqual(800);
  });
});
