#!/usr/bin/env node
// Rescue an orphaned desktop audio recording INTO ITS EXISTING media_objects
// row (unlike rescue-orphan-audio-note.mjs, which inserts a new row). Keeps
// the row's title, attendees, folder, slug, and note URL intact — important
// when calendar attendees were already attached at /start time.
//
// Mirrors what POST /api/recordings/[id]/complete does for a two-track audio
// recording: upload tracks to R2 at keyForTrack() paths, set r2 keys +
// duration + status='transcribing', clear upload_metadata, enqueue mix_audio.
// The prod mix_audio worker fans out to transcribe + audio_waveform, and the
// Deepgram webhook fans out the AI jobs from there.
//
// Usage:
//   DOPPLER_TOKEN=<prd_loom service token> doppler run -- \
//     node scripts/rescue-orphan-into-existing-row.mjs <orphanDir> [--execute]
//
// Without --execute it is a read-only preflight: verifies the row, the files,
// and the computed plan, writes nothing.

import postgres from "postgres";
import { PgBoss } from "pg-boss";
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const orphanDir = process.argv[2];
const execute = process.argv.includes("--execute");
if (!orphanDir) {
  console.error("usage: node rescue-orphan-into-existing-row.mjs <orphanDir> [--execute]");
  process.exit(1);
}

const metadata = JSON.parse(await readFile(join(orphanDir, "metadata.json"), "utf8"));
const recordingId = metadata.originalRecordingId;
const slug = metadata.originalSlug;
if (!recordingId || !slug) {
  throw new Error("orphan metadata has no originalRecordingId/originalSlug — use rescue-orphan-audio-note.mjs (new-row path) instead");
}
if (metadata.rescuedAt) {
  throw new Error(`orphan already marked rescued at ${metadata.rescuedAt} (slug ${metadata.rescuedSlug})`);
}

const micPath = join(orphanDir, "mic.m4a");
const sysPath = join(orphanDir, "system-audio.m4a");
const micStat = await stat(micPath);
const sysStat = await stat(sysPath);

async function probeDuration(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`ffprobe failed for ${file}`);
  return seconds;
}
const durationSeconds = Math.max(await probeDuration(micPath), await probeDuration(sysPath));

const micKey = `${slug}/raw/mic.m4a`;
const sysKey = `${slug}/raw/system-audio.m4a`;

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const rows = await sql`
  SELECT id, slug, title, status, type, duration_seconds, r2_mic_key, r2_systemaudio_key, deleted_at
  FROM media_objects WHERE id = ${recordingId}
`;
if (rows.length !== 1) throw new Error(`row ${recordingId} not found`);
const row = rows[0];
if (row.slug !== slug) throw new Error(`slug mismatch: row=${row.slug} orphan=${slug}`);
if (row.type !== "audio") throw new Error(`row type is ${row.type}, expected audio`);
if (row.deleted_at) throw new Error(`row is in trash (deleted_at=${row.deleted_at}) — restore it first`);
if (row.r2_mic_key || row.r2_systemaudio_key) {
  throw new Error(`row already has audio keys (mic=${row.r2_mic_key} sys=${row.r2_systemaudio_key}) — refusing to overwrite`);
}

console.log(`[rescue] row ok: "${row.title}" (${row.status}) slug=${slug}`);
console.log(`[rescue] plan: upload mic ${(micStat.size / 1e6).toFixed(1)}MB -> ${micKey}`);
console.log(`[rescue]       upload sys ${(sysStat.size / 1e6).toFixed(1)}MB -> ${sysKey}`);
console.log(`[rescue]       duration ${durationSeconds.toFixed(1)}s (${(durationSeconds / 60).toFixed(1)} min)`);
console.log(`[rescue]       then: status=transcribing, enqueue mix_audio`);

if (!execute) {
  console.log("[rescue] preflight only — re-run with --execute to perform the rescue");
  await sql.end();
  process.exit(0);
}

const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME ?? process.env.R2_BUCKET;
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// R2 intermittently 500s on large single PUTs (the 224MB July 5 mic track
// died this way). Multipart with per-part retry rides through those.
const PART_SIZE = 16 * 1024 * 1024;

async function uploadToR2(key, file, size) {
  console.log(`[rescue] uploading ${key} (${(size / 1e6).toFixed(1)}MB)...`);
  if (size <= PART_SIZE) {
    await r2.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: "audio/mp4",
    }));
    console.log(`[rescue] uploaded ${key}`);
    return;
  }

  const { UploadId } = await r2.send(new CreateMultipartUploadCommand({
    Bucket: bucket, Key: key, ContentType: "audio/mp4",
  }));
  const handle = await open(file, "r");
  try {
    const partCount = Math.ceil(size / PART_SIZE);
    const parts = [];
    for (let i = 0; i < partCount; i++) {
      const start = i * PART_SIZE;
      const length = Math.min(PART_SIZE, size - start);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      let lastError;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const { ETag } = await r2.send(new UploadPartCommand({
            Bucket: bucket, Key: key, UploadId,
            PartNumber: i + 1, Body: buffer, ContentLength: length,
          }));
          parts.push({ PartNumber: i + 1, ETag });
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          console.log(`[rescue]   part ${i + 1}/${partCount} attempt ${attempt} failed: ${err.name ?? err}`);
          await new Promise((r) => setTimeout(r, attempt * 2000));
        }
      }
      if (lastError) {
        await r2.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId }));
        throw lastError;
      }
      if ((i + 1) % 4 === 0 || i + 1 === partCount) {
        console.log(`[rescue]   ${i + 1}/${partCount} parts done`);
      }
    }
    await r2.send(new CompleteMultipartUploadCommand({
      Bucket: bucket, Key: key, UploadId, MultipartUpload: { Parts: parts },
    }));
  } finally {
    await handle.close();
  }
  console.log(`[rescue] uploaded ${key}`);
}

await uploadToR2(micKey, micPath, micStat.size);
await uploadToR2(sysKey, sysPath, sysStat.size);

await sql`
  UPDATE media_objects SET
    r2_mic_key = ${micKey},
    r2_systemaudio_key = ${sysKey},
    duration_seconds = ${String(durationSeconds)},
    status = 'transcribing',
    upload_metadata = NULL,
    updated_at = now()
  WHERE id = ${recordingId}
`;
console.log(`[rescue] row updated to transcribing`);

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
boss.on("error", (e) => console.error("[pg-boss]", e));
await boss.start();
await boss.createQueue("mix_audio");
await boss.send(
  "mix_audio",
  { mediaObjectId: recordingId, micKey, systemAudioKey: sysKey },
  { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 3600 }
);
await boss.stop();
console.log(`[rescue] enqueued mix_audio for ${recordingId}`);

metadata.rescuedAt = new Date().toISOString();
metadata.rescuedSlug = slug;
metadata.lastError = null;
await writeFile(join(orphanDir, "metadata.json"), JSON.stringify(metadata, null, 2));
console.log(`[rescue] orphan marked rescued`);

await sql.end();
console.log(`
[rescue] DONE — https://loom.dissonance.cloud/notes/${slug}
Deepgram webhook should fire in ~1-3 min; AI pipeline fans out from there.
`);
