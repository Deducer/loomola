import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getStartedBoss } from "@/lib/queue/boss";
import { buildHealthPayload, type QueueHealth } from "@/lib/health/payload";

export const dynamic = "force-dynamic";

type QueueStatRow = {
  name: string;
  pending: number;
  active: number;
  failed: number;
  oldest_pending_sec: number | null;
};

export async function GET() {
  const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "unknown";

  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (err) {
    console.error("[health] db check failed:", err);
  }

  let queues: QueueHealth[] = [];
  if (dbOk) {
    try {
      const rows = await db.execute<QueueStatRow>(sql`
        select
          name,
          count(*) filter (where state in ('created', 'retry'))::int as pending,
          count(*) filter (where state = 'active')::int as active,
          count(*) filter (where state = 'failed')::int as failed,
          extract(epoch from now() - min(created_on)
            filter (where state in ('created', 'retry')))::int as oldest_pending_sec
        from pgboss.job
        group by name
        order by name
      `);
      queues = Array.from(rows).map((row) => ({
        name: row.name,
        pending: row.pending,
        active: row.active,
        failed: row.failed,
        oldestPendingSec: row.oldest_pending_sec,
      }));
    } catch (err) {
      // Fresh install: the pgboss schema doesn't exist until boss first
      // starts. DB itself is fine — report empty queue info, not "down".
      console.warn("[health] pgboss stats unavailable:", err);
    }
  }

  const { body, httpStatus } = buildHealthPayload({
    dbOk,
    bossStarted: getStartedBoss() !== null,
    queues,
    commit,
  });
  return NextResponse.json(body, { status: httpStatus });
}
