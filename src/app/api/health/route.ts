import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getStartedBoss } from "@/lib/queue/boss";
import { buildHealthPayload, type QueueHealth } from "@/lib/health/payload";

export const dynamic = "force-dynamic";

/// Written by the Dockerfile build stage. NEXT_PUBLIC_BUILD_COMMIT is
/// inlined at build time and Coolify doesn't reliably pass a commit ARG,
/// so a runtime-readable file is the stamp that always works — worst
/// case it still carries the build timestamp.
type BuildStamp = { commit?: string; builtAt?: string };
let cachedStamp: BuildStamp | null | undefined;

function readBuildStamp(): BuildStamp | null {
  if (cachedStamp !== undefined) return cachedStamp;
  try {
    cachedStamp = JSON.parse(
      readFileSync(join(process.cwd(), "build-stamp.json"), "utf8")
    ) as BuildStamp;
  } catch {
    cachedStamp = null;
  }
  return cachedStamp;
}

type QueueStatRow = {
  name: string;
  pending: number;
  active: number;
  failed: number;
  oldest_pending_sec: number | null;
};

export async function GET() {
  const stamp = readBuildStamp();
  const commit =
    (stamp?.commit && stamp.commit !== "unknown" ? stamp.commit : null) ??
    process.env.NEXT_PUBLIC_BUILD_COMMIT ??
    "unknown";

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
    builtAt: stamp?.builtAt ?? null,
  });
  return NextResponse.json(body, { status: httpStatus });
}
