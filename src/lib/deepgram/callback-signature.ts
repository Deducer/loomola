import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhookNonces } from "@/db/schema";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEEPGRAM_PROVIDER = "deepgram";

function getSecret(): string {
  const secret = process.env.DEEPGRAM_CALLBACK_SIGNING_SECRET;
  if (!secret) {
    throw new Error("DEEPGRAM_CALLBACK_SIGNING_SECRET is not set");
  }
  return secret;
}

/** Pure HMAC layer — public for unit testing of the signing math. */
export function signNonce(recordingId: string, nonce: string): string {
  return createHmac("sha256", getSecret())
    .update(`${recordingId}:${nonce}`)
    .digest("hex");
}

/** Constant-time HMAC compare; returns false on any malformed input. */
export function verifyNonceSignature(
  recordingId: string,
  nonce: string,
  signature: string
): boolean {
  if (!signature) return false;
  const expected = signNonce(recordingId, nonce);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

export interface NonceStore {
  insert(
    nonce: string,
    recordingId: string,
    expiresAtMs: number
  ): Promise<void>;
  /** Atomically marks the nonce consumed and returns true; returns false on
   * any of: nonce not found, recording-id mismatch, already-consumed, or
   * expired. */
  consumeIfValid(
    nonce: string,
    recordingId: string,
    nowMs: number
  ): Promise<boolean>;
}

const dbNonceStore: NonceStore = {
  async insert(nonce, recordingId, expiresAtMs) {
    await db.insert(webhookNonces).values({
      nonce,
      recordingId,
      provider: DEEPGRAM_PROVIDER,
      expiresAt: new Date(expiresAtMs),
    });
  },
  async consumeIfValid(nonce, recordingId, nowMs) {
    const now = new Date(nowMs);
    const updated = await db
      .update(webhookNonces)
      .set({ consumedAt: now })
      .where(
        and(
          eq(webhookNonces.nonce, nonce),
          eq(webhookNonces.recordingId, recordingId),
          isNull(webhookNonces.consumedAt),
          gt(webhookNonces.expiresAt, now)
        )
      )
      .returning({ nonce: webhookNonces.nonce });
    return updated.length > 0;
  },
};

/** Test-only in-memory implementation. Production code never touches this. */
export function createInMemoryNonceStore(): NonceStore {
  type Row = {
    recordingId: string;
    expiresAtMs: number;
    consumedAtMs?: number;
  };
  const map = new Map<string, Row>();
  return {
    async insert(nonce, recordingId, expiresAtMs) {
      map.set(nonce, { recordingId, expiresAtMs });
    },
    async consumeIfValid(nonce, recordingId, nowMs) {
      const row = map.get(nonce);
      if (!row) return false;
      if (row.recordingId !== recordingId) return false;
      if (row.consumedAtMs !== undefined) return false;
      if (row.expiresAtMs <= nowMs) return false;
      row.consumedAtMs = nowMs;
      return true;
    },
  };
}

export interface IssueOptions {
  recordingId: string;
  ttlMs?: number;
  store?: NonceStore;
  now?: number;
}

/** Mint a single-use nonce + signature for a Deepgram callback URL.
 *  The nonce is persisted; the caller embeds both into the outbound URL. */
export async function issueDeepgramCallbackToken(
  opts: IssueOptions
): Promise<{ nonce: string; sig: string }> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const store = opts.store ?? dbNonceStore;
  const now = opts.now ?? Date.now();
  const nonce = randomBytes(32).toString("hex");
  await store.insert(nonce, opts.recordingId, now + ttlMs);
  const sig = signNonce(opts.recordingId, nonce);
  return { nonce, sig };
}

export interface VerifyOptions {
  recordingId: string;
  nonce: string;
  sig: string;
  store?: NonceStore;
  now?: number;
}

/** Verify HMAC, then atomically consume the nonce. Returns true exactly once
 *  per issued token. Replays, expired tokens, and tampered signatures all
 *  return false. */
export async function verifyAndConsumeCallbackToken(
  opts: VerifyOptions
): Promise<boolean> {
  if (!verifyNonceSignature(opts.recordingId, opts.nonce, opts.sig)) {
    return false;
  }
  const store = opts.store ?? dbNonceStore;
  const now = opts.now ?? Date.now();
  return store.consumeIfValid(opts.nonce, opts.recordingId, now);
}

/** Best-effort cleanup of expired nonces. Safe to call from a cron. */
export async function pruneExpiredNonces(
  now: Date = new Date()
): Promise<number> {
  const deleted = await db.execute(
    sql`DELETE FROM webhook_nonces WHERE expires_at < ${now}`
  );
  return Number((deleted as unknown as { count?: number }).count ?? 0);
}
