import { describe, expect, it } from "vitest";
import { buildHealthPayload } from "@/lib/health/payload";

const QUEUE = {
  name: "transcribe",
  pending: 0,
  active: 0,
  failed: 0,
  oldestPendingSec: null as number | null,
};

describe("buildHealthPayload", () => {
  it("ok: db up, boss started, queues healthy → 200", () => {
    const { body, httpStatus } = buildHealthPayload({
      dbOk: true,
      bossStarted: true,
      queues: [QUEUE],
      commit: "abc1234",
    });
    expect(httpStatus).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.boss).toEqual({ started: true, queues: [QUEUE] });
    expect(body.commit).toBe("abc1234");
  });

  it("degraded (still 200) when boss has not started", () => {
    const { body, httpStatus } = buildHealthPayload({
      dbOk: true,
      bossStarted: false,
      queues: [],
      commit: "abc1234",
    });
    expect(httpStatus).toBe(200);
    expect(body.status).toBe("degraded");
  });

  it("degraded when a queue has failed jobs", () => {
    const { body } = buildHealthPayload({
      dbOk: true,
      bossStarted: true,
      queues: [{ ...QUEUE, failed: 2 }],
      commit: "abc1234",
    });
    expect(body.status).toBe("degraded");
  });

  it("degraded when the oldest pending job exceeds 10 minutes", () => {
    const fresh = buildHealthPayload({
      dbOk: true,
      bossStarted: true,
      queues: [{ ...QUEUE, pending: 1, oldestPendingSec: 30 }],
      commit: "c",
    });
    expect(fresh.body.status).toBe("ok");
    const stale = buildHealthPayload({
      dbOk: true,
      bossStarted: true,
      queues: [{ ...QUEUE, pending: 1, oldestPendingSec: 700 }],
      commit: "c",
    });
    expect(stale.body.status).toBe("degraded");
  });

  it("down: db unreachable → 503 with empty queue info", () => {
    const { body, httpStatus } = buildHealthPayload({
      dbOk: false,
      bossStarted: false,
      queues: [],
      commit: "abc1234",
    });
    expect(httpStatus).toBe(503);
    expect(body.status).toBe("down");
    expect(body.db).toBe("down");
    expect(typeof body.ts).toBe("string"); // legacy key preserved
  });
});
