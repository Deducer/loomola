import postgres from "postgres";
import { DeepgramClient } from "@deepgram/sdk";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, randomBytes } from "node:crypto";

const OWNER_ID = "612bc4b4-2a6c-4721-8820-f256e4eb0ef6";
const COMPOSITE_KEY = "iMoZLHX7CF/composite.webm";
const DURATION = 12.026;
const APP_URL = "https://loom.dissonance.cloud";

function newSlug() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const bytes = randomBytes(10);
  for (let i = 0; i < 10; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

const slug = newSlug();
const [row] = await sql`
  INSERT INTO media_objects (owner_id, type, slug, status, duration_seconds, r2_composite_key, upload_metadata)
  VALUES (${OWNER_ID}, 'video', ${slug}, 'transcribing', ${DURATION}, ${COMPOSITE_KEY}, '{}'::jsonb)
  RETURNING id, slug
`;
const mediaId = row.id;
console.log("[e2e] created media_object", { mediaId, slug });

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
console.log("[e2e] signed R2 URL OK");

const sig = createHmac("sha256", process.env.DEEPGRAM_CALLBACK_SIGNING_SECRET).update(mediaId).digest("hex");
const callbackUrl = `${APP_URL}/api/webhooks/deepgram/${mediaId}/${sig}`;

const dg = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
await dg.listen.v1.media.transcribeUrl({
  url: videoUrl,
  callback: callbackUrl,
  model: "nova-2",
  smart_format: true,
  language: "en",
});
console.log("[e2e] Deepgram transcribe submitted");
console.log("MEDIA_ID=" + mediaId);
console.log("SLUG=" + slug);

await sql.end();
