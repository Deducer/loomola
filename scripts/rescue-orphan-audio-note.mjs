#!/usr/bin/env node
// One-shot rescue: a 72-minute audio note recording (Zoom call) was captured
// to local temp on the desktop on 2026-05-06 but never produced a media_objects
// row server-side. Both raw track files survived in /var/folders. This script:
//   1. Backs up mic.m4a + system-audio.m4a to ~/Loomola-rescued-2026-05-06/
//   2. Mixes them locally with ffmpeg (same filter the mix_audio job uses)
//   3. Uploads mic / system-audio / mixed tracks to R2
//   4. Inserts a media_objects row in 'transcribing' status
//   5. Enqueues the transcribe pg-boss job — Deepgram → AI pipeline takes over
//
// Usage:
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     node scripts/rescue-orphan-audio-note.mjs

import postgres from "postgres";
import { PgBoss } from "pg-boss";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import { mkdir, copyFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { customAlphabet } from "nanoid";
import { randomUUID } from "node:crypto";

// ---------------- constants for THIS rescue ----------------
const SOURCE_DIR =
  "/private/var/folders/rx/p_9flz6x2_ngmypgmds0cj040000gn/T/loom-audio-3D1FB16F-569D-4370-AB1B-C856384C2EA1";
const MIC_PATH = join(SOURCE_DIR, "mic.m4a");
const SYS_PATH = join(SOURCE_DIR, "system-audio.m4a");
const OWNER_ID = "612bc4b4-2a6c-4721-8820-f256e4eb0ef6"; // you@example.com
const DURATION_SECONDS = 4362.453333;
// File mtime was 16:16 local (21:16 UTC); a 72.7-min recording ends there means
// it started at ~15:04 local = 20:04 UTC.
const RECORDED_AT = new Date("2026-05-06T20:04:00.000Z");
const TITLE = "Recovered call (rescued from local cache)";

// ---------------- step 1: backup ----------------
const backupDir = join(homedir(), "Loomola-rescued-2026-05-06");
await mkdir(backupDir, { recursive: true });
const backupMic = join(backupDir, "mic.m4a");
const backupSys = join(backupDir, "system-audio.m4a");
const mixedPath = join(backupDir, "mixed.m4a");
await copyFile(MIC_PATH, backupMic);
await copyFile(SYS_PATH, backupSys);
console.log(`[rescue] backed up source tracks to ${backupDir}`);

// ---------------- step 2: ffmpeg mix locally ----------------
console.log("[rescue] mixing mic + system audio with ffmpeg...");
await new Promise((resolve, reject) => {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    MIC_PATH,
    "-i",
    SYS_PATH,
    "-filter_complex",
    "[0:a]aformat=channel_layouts=mono[mic];[1:a]aformat=channel_layouts=mono[system];[mic][system]amix=inputs=2:duration=longest:normalize=1[out]",
    "-map",
    "[out]",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-y",
    mixedPath,
  ];
  const proc = spawn("ffmpeg", args, { stdio: "inherit" });
  proc.on("error", reject);
  proc.on("close", (code) =>
    code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))
  );
});
const mixedStat = await stat(mixedPath);
console.log(
  `[rescue] mixed: ${mixedPath}  (${(mixedStat.size / 1024 / 1024).toFixed(1)} MB)`
);

// ---------------- step 3: generate slug + R2 keys ----------------
const generateSlug = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  10
);
const slug = generateSlug();
const micKey = `${slug}/raw/mic.m4a`;
const sysKey = `${slug}/raw/system-audio.m4a`;
const mixedKey = `${slug}/mixed.m4a`;
console.log(`[rescue] new slug: ${slug}`);

// ---------------- step 4: upload to R2 ----------------
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME ?? process.env.R2_BUCKET;
if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error(
    `Missing R2 env (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME). bucket=${bucket}`
  );
}
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function uploadToR2(key, file) {
  const { size } = await stat(file);
  console.log(`[rescue] uploading ${key}  (${(size / 1024 / 1024).toFixed(1)} MB) ...`);
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: "audio/mp4",
    })
  );
  console.log(`[rescue] uploaded ${key}`);
}

await uploadToR2(micKey, MIC_PATH);
await uploadToR2(sysKey, SYS_PATH);
await uploadToR2(mixedKey, mixedPath);

// ---------------- step 5: insert media_objects row ----------------
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const recordingId = randomUUID();
await sql`
  INSERT INTO media_objects
    (id, owner_id, type, slug, title, status, duration_seconds,
     r2_mic_key, r2_systemaudio_key, r2_mixed_key,
     created_at, updated_at)
  VALUES
    (${recordingId}, ${OWNER_ID}, 'audio', ${slug}, ${TITLE}, 'transcribing',
     ${DURATION_SECONDS},
     ${micKey}, ${sysKey}, ${mixedKey},
     ${RECORDED_AT}, now())
`;
console.log(`[rescue] inserted media_objects id=${recordingId} slug=${slug}`);

// ---------------- step 6: enqueue transcribe job ----------------
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
boss.on("error", (e) => console.error("[pg-boss]", e));
await boss.start();
await boss.createQueue("transcribe");
await boss.send(
  "transcribe",
  { mediaObjectId: recordingId, audioKey: mixedKey },
  { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 3600 }
);
console.log(`[rescue] enqueued transcribe job for ${recordingId}`);

await boss.stop();
await sql.end();

console.log(`
[rescue] DONE
  recording id : ${recordingId}
  slug         : ${slug}
  notes URL    : https://loom.dissonance.cloud/notes/${slug}
  backup dir   : ${backupDir}

Deepgram should call our webhook within ~1-3 minutes; the AI pipeline
(title/summary, action items, embeddings) fans out from there.
`);
