#!/usr/bin/env node
// One-off: requeue failed title-summary + action-items jobs for a single
// recording. Usage: doppler run --project dissonance-cloud --config prd_loom -- node scripts/requeue-ai-jobs.mjs <mediaObjectId>
import { PgBoss } from "pg-boss";

const id = process.argv[2];
if (!id) {
  console.error("usage: node scripts/requeue-ai-jobs.mjs <mediaObjectId>");
  process.exit(1);
}

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
boss.on("error", (err) => console.error("[pg-boss]", err));
await boss.start();

await boss.createQueue("generate_title_summary");
await boss.createQueue("extract_action_items");

const opts = { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 1800 };
await boss.send("generate_title_summary", { mediaObjectId: id }, opts);
await boss.send("extract_action_items", { mediaObjectId: id }, opts);

console.log(`requeued title-summary + action-items for ${id}`);
await boss.stop();
