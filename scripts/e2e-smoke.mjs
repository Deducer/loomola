// Full-pipeline smoke for Stage 1.
// Usage: `npm run smoke` (doppler-wrapped) or
//        `doppler run --project dissonance-cloud --config prd_loom -- node scripts/e2e-smoke.mjs`
//
// Exercises: insert media -> Deepgram -> webhook -> 4 AI jobs -> viewer HTML
// -> password gate -> unlock -> refresh-url -> comment -> trim. Cleans up.
// Note: rate limit allows ~3 runs per 5 minutes from the same public IP
// before comment POSTs start 429-ing.

import postgres from "postgres";
import bcrypt from "bcryptjs";
import { DeepgramClient } from "@deepgram/sdk";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, randomBytes } from "node:crypto";

const OWNER_ID = "612bc4b4-2a6c-4721-8820-f256e4eb0ef6";
const COMPOSITE_KEY = "iMoZLHX7CF/composite.webm";
const DURATION = 12.026;
const APP_URL = process.env.APP_URL ?? "https://loom.dissonance.cloud";
const TEST_PASSWORD = "m11-smoke-pass";

function newSlug() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const bytes = randomBytes(10);
  for (let i = 0; i < 10; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

let stepIndex = 0;
async function step(name, fn) {
  stepIndex += 1;
  const t0 = Date.now();
  try {
    const result = await fn();
    console.log(`  ✓ ${stepIndex}. ${name} (${Date.now() - t0}ms)`);
    return result;
  } catch (e) {
    console.error(`  ✗ ${stepIndex}. ${name} (${Date.now() - t0}ms): ${e.message}`);
    throw e;
  }
}

let mediaId = null;
let slug = null;
let unlockCookie = null;

async function main() {
  console.log(`[smoke] target: ${APP_URL}`);

  await step("insert media_object", async () => {
    slug = newSlug();
    const [row] = await sql`
      INSERT INTO media_objects (owner_id, type, slug, status, duration_seconds, r2_composite_key, upload_metadata)
      VALUES (${OWNER_ID}, 'video', ${slug}, 'transcribing', ${DURATION}, ${COMPOSITE_KEY}, '{}'::jsonb)
      RETURNING id, slug
    `;
    mediaId = row.id;
  });

  await step("fire deepgram transcribe", async () => {
    const r2 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    const videoUrl = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: COMPOSITE_KEY }),
      { expiresIn: 3600 }
    );
    const sig = createHmac("sha256", process.env.DEEPGRAM_CALLBACK_SIGNING_SECRET)
      .update(mediaId)
      .digest("hex");
    const callbackUrl = `${APP_URL}/api/webhooks/deepgram/${mediaId}/${sig}`;
    const dg = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
    await dg.listen.v1.media.transcribeUrl({
      url: videoUrl,
      callback: callbackUrl,
      model: "nova-2",
      smart_format: true,
      language: "en",
    });
  });

  await step("pipeline reaches status=ready (<=120s)", async () => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const [mo] = await sql`SELECT status, composite_thumbnail_key FROM media_objects WHERE id = ${mediaId}`;
      const [ao] = await sql`SELECT title_suggested, summary FROM ai_outputs WHERE media_object_id = ${mediaId}`;
      if (mo.status === "ready" && mo.composite_thumbnail_key && ao?.title_suggested && ao?.summary) {
        return;
      }
      if (mo.status === "failed") throw new Error("recording status=failed");
      await new Promise((r) => setTimeout(r, 3000));
    }
    const [mo] = await sql`SELECT status FROM media_objects WHERE id = ${mediaId}`;
    const jobs = await sql`SELECT name, state FROM pgboss.job WHERE data::text LIKE ${'%' + mediaId + '%'}`;
    throw new Error(`timeout; status=${mo?.status} jobs=${JSON.stringify(jobs)}`);
  });

  await step("GET /v/:slug renders viewer", async () => {
    const res = await fetch(`${APP_URL}/v/${slug}`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    for (const token of ["<video", "plyr", "Transcript"]) {
      if (!html.includes(token)) throw new Error(`missing "${token}"`);
    }
  });

  await step("set password + gate renders", async () => {
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    await sql`UPDATE media_objects SET password_hash = ${hash} WHERE id = ${mediaId}`;
    const res = await fetch(`${APP_URL}/v/${slug}`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes("Password required")) throw new Error("gate not rendered");
  });

  await step("POST /unlock sets cookie", async () => {
    const res = await fetch(`${APP_URL}/v/${slug}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = setCookie.match(new RegExp(`view_unlock_${slug}=([^;]+)`));
    if (!match) throw new Error(`no view_unlock_${slug} cookie in Set-Cookie`);
    unlockCookie = `view_unlock_${slug}=${match[1]}`;
  });

  await step("refresh-url returns signed URL", async () => {
    const res = await fetch(`${APP_URL}/api/v/${slug}/refresh-url`, {
      method: "POST",
      headers: { cookie: unlockCookie },
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body.url || !body.url.startsWith("http")) throw new Error(`no url in body`);
  });

  await step("POST /comments creates row", async () => {
    const res = await fetch(`${APP_URL}/api/v/${slug}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: unlockCookie,
      },
      body: JSON.stringify({
        name: "Smoke",
        email: "smoke@example.com",
        timestampSec: 5,
        body: "m11-smoke-test comment",
      }),
    });
    if (res.status !== 201) throw new Error(`HTTP ${res.status}`);
    const [row] = await sql`
      SELECT commenter_name, body FROM comments WHERE media_object_id = ${mediaId}
    `;
    if (!row || row.body !== "m11-smoke-test comment") {
      throw new Error(`comment not found in DB`);
    }
  });

  await step("set trim + HTML carries values", async () => {
    await sql`UPDATE media_objects SET trim_start_sec = 2, trim_end_sec = 8 WHERE id = ${mediaId}`;
    const res = await fetch(`${APP_URL}/v/${slug}`, {
      headers: { cookie: unlockCookie },
    });
    const html = await res.text();
    if (!html.includes("trimStartSec") || !html.includes("trimEndSec")) {
      throw new Error(`trim values not serialized into page`);
    }
  });
}

async function cleanup() {
  if (!mediaId) return;
  try {
    await sql`DELETE FROM media_objects WHERE id = ${mediaId}`;
    console.log(`  ✓ cleanup: deleted media_object ${mediaId}`);
  } catch (e) {
    console.error(`  ✗ cleanup failed: ${e.message}`);
  }
}

const startedAt = Date.now();
try {
  await main();
  await cleanup();
  console.log(`[smoke] all ${stepIndex} steps passed in ${Date.now() - startedAt}ms`);
  await sql.end();
  process.exit(0);
} catch (e) {
  await cleanup();
  console.error(`[smoke] FAILED after ${Date.now() - startedAt}ms: ${e.message}`);
  await sql.end();
  process.exit(1);
}
