// Rate-limited HTTP client over Granola's reverse-engineered endpoints.
//
// Three calls used by v1:
//   /v2/get-me                  — verify self identity at boot
//   /v1/get-document-transcript — fill transcripts not in local cache
//   /v2/get-people-batch        — enrich attendee names/emails
//
// Auth: WorkOS access token from supabase.json, with one refresh-retry
// on 401. Rate limited via a token bucket — Granola's documented
// official-API limits are 25/5s burst, 5/s sustained; we apply the
// same to the reverse-engineered endpoints conservatively.

import type { GranolaAuth } from "./auth";

const BASE = "https://api.granola.ai";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type GranolaApiClientOpts = {
  fetch?: FetchLike;
  rateLimitTokensPerSec?: number;
  rateLimitBurst?: number;
};

class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    public readonly tokensPerSec: number,
    public readonly burst: number
  ) {
    this.tokens = burst;
    this.last = Date.now();
  }
  async take(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = ((1 - this.tokens) / this.tokensPerSec) * 1000;
      await new Promise((r) => setTimeout(r, Math.ceil(waitMs)));
    }
  }
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(
      this.burst,
      this.tokens + elapsed * this.tokensPerSec
    );
  }
}

export class GranolaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "GranolaApiError";
  }
}

export class GranolaApiClient {
  private fetch: FetchLike;
  private bucket: TokenBucket;

  constructor(
    private auth: GranolaAuth,
    opts: GranolaApiClientOpts = {}
  ) {
    this.fetch = opts.fetch ?? (globalThis.fetch as FetchLike);
    this.bucket = new TokenBucket(
      opts.rateLimitTokensPerSec ?? 5,
      opts.rateLimitBurst ?? 25
    );
  }

  async getMe(): Promise<{ id: string; email?: string }> {
    return this.post("/v2/get-me", {});
  }

  async getDocumentTranscript(
    docId: string
  ): Promise<{ segments: unknown[]; full_text: string } | null> {
    try {
      return await this.post("/v1/get-document-transcript", {
        document_id: docId,
      });
    } catch (e) {
      if (e instanceof GranolaApiError && e.status === 404) return null;
      throw e;
    }
  }

  async getPeopleBatch(personIds: string[]): Promise<unknown[]> {
    if (personIds.length === 0) return [];
    return this.post("/v2/get-people-batch", { person_ids: personIds });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.requestWithRefresh<T>(path, body, false);
  }

  private async requestWithRefresh<T>(
    path: string,
    body: unknown,
    retried: boolean
  ): Promise<T> {
    await this.bucket.take();
    const res = await this.fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.auth.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401 && !retried) {
      await this.auth.refresh();
      return this.requestWithRefresh<T>(path, body, true);
    }
    if (!res.ok) {
      throw new GranolaApiError(
        `Granola ${path} failed (${res.status})`,
        res.status
      );
    }
    return (await res.json()) as T;
  }
}
