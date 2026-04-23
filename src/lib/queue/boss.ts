import { PgBoss } from "pg-boss";
import { TRANSCRIBE_JOB, runTranscribeJob, type TranscribeJobData } from "./jobs/transcribe";

let cached: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function init(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const boss = new PgBoss({
    connectionString,
    max: 4,
  });

  boss.on("error", (err: unknown) => {
    console.error("[pg-boss] error:", err);
  });

  await boss.start();

  // pg-boss v10+ requires queues to exist before send()/work() — no auto-create.
  // Idempotent: safe to call on every boot.
  await boss.createQueue(TRANSCRIBE_JOB);

  await boss.work<TranscribeJobData>(TRANSCRIBE_JOB, async (jobs) => {
    // pg-boss delivers jobs in batches; process each.
    for (const job of jobs) {
      await runTranscribeJob(job.data);
    }
  });

  console.log("[pg-boss] started and workers registered");
  return boss;
}

/** Returns a started pg-boss singleton. Safe to call concurrently. */
export async function getBoss(): Promise<PgBoss> {
  if (cached) return cached;
  if (!starting) {
    starting = init().then((b) => {
      cached = b;
      return b;
    });
  }
  return starting;
}

/** Enqueues a transcription job for the given recording. */
export async function enqueueTranscription(
  data: TranscribeJobData
): Promise<void> {
  const boss = await getBoss();
  await boss.send(TRANSCRIBE_JOB, data, {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 3600, // allow up to 1h for Deepgram to respond
  });
}
