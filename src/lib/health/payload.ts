// Pure assembly of the /api/health response. Payload must stay
// NON-SENSITIVE: the endpoint is public (middleware allowlists the exact
// path). Queue names, integer counts, and the short build commit only.

export type QueueHealth = {
  name: string;
  pending: number;
  active: number;
  failed: number;
  oldestPendingSec: number | null;
};

export type HealthPayload = {
  status: "ok" | "degraded" | "down";
  ts: string;
  commit: string;
  db: "ok" | "down";
  boss: { started: boolean; queues: QueueHealth[] };
};

/** A pending job older than this means workers aren't keeping up (or
 * aren't running) — degraded, not down: the app still serves traffic. */
const STALE_PENDING_SEC = 10 * 60;

export function buildHealthPayload(input: {
  dbOk: boolean;
  bossStarted: boolean;
  queues: QueueHealth[];
  commit: string;
  now?: Date;
}): { body: HealthPayload; httpStatus: number } {
  const ts = (input.now ?? new Date()).toISOString();

  if (!input.dbOk) {
    return {
      body: {
        status: "down",
        ts,
        commit: input.commit,
        db: "down",
        boss: { started: input.bossStarted, queues: [] },
      },
      httpStatus: 503,
    };
  }

  const degraded =
    !input.bossStarted ||
    input.queues.some(
      (q) => q.failed > 0 || (q.oldestPendingSec ?? 0) > STALE_PENDING_SEC
    );

  return {
    body: {
      status: degraded ? "degraded" : "ok",
      ts,
      commit: input.commit,
      db: "ok",
      boss: { started: input.bossStarted, queues: input.queues },
    },
    httpStatus: 200,
  };
}
