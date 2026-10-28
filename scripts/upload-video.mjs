// Upload an existing video file to Loomola as a finished recording.
//
// Uses the same API the browser recorder and desktop app use:
//   POST /api/recordings/start  -> recording row + R2 multipart upload id
//   POST /api/recordings/:id/part-url (per part) -> presigned PUT
//   PUT  <presigned url>        -> R2
//   POST /api/recordings/:id/complete -> kicks off transcode/thumb/transcript/AI
//
// Usage:
//   node scripts/upload-video.mjs [--title "..."] [--app https://loom.dissonance.cloud] <file.mp4> [more files...]
//
// Auth: signs in to Supabase with password. Reads SUPABASE_URL, SUPABASE_ANON_KEY,
// TEST_CREATOR_EMAIL, TEST_CREATOR_PASSWORD from the environment (.env.local
// is loaded if present). The title defaults to the file name; the AI title job
// will overwrite it once the transcript lands unless you pass --title.

import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const PART_SIZE = 8 * 1024 * 1024; // 8 MiB (R2 minimum is 5 MiB for all but the last part)

function loadDotEnv(path = ".env.local") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadDotEnv();

const args = process.argv.slice(2);
let title = null;
let appUrl = process.env.APP_URL ?? "https://loom.dissonance.cloud";
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--title") title = args[++i];
  else if (args[i] === "--app") appUrl = args[++i];
  else files.push(args[i]);
}
if (files.length === 0) {
  console.error("usage: node scripts/upload-video.mjs [--title T] [--app URL] <file> [...]");
  process.exit(2);
}
if (title && files.length > 1) {
  console.error("--title only makes sense with a single file");
  process.exit(2);
}

const { SUPABASE_URL, SUPABASE_ANON_KEY, TEST_CREATOR_EMAIL, TEST_CREATOR_PASSWORD } = process.env;
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, TEST_CREATOR_EMAIL, TEST_CREATOR_PASSWORD })) {
  if (!v) { console.error(`missing env ${k}`); process.exit(2); }
}

function mimeFor(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".mp4" || ext === ".m4v" || ext === ".mov") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  throw new Error(`unsupported extension ${ext} (use mp4/mov/webm)`);
}

function durationSeconds(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ], { encoding: "utf8" });
  const d = parseFloat(out.trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe could not read duration of ${file}`);
  return d;
}

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: TEST_CREATOR_EMAIL, password: TEST_CREATOR_PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

async function api(token, path, body) {
  const res = await fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`${path} redirected (${res.status}) — auth token rejected?`);
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function putWithRetry(url, buf, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { method: "PUT", body: buf });
      if (!res.ok) throw new Error(`PUT ${res.status} ${await res.text()}`);
      const etag = res.headers.get("etag");
      if (!etag) throw new Error("R2 returned no ETag");
      return etag;
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw lastErr;
}

async function uploadOne(token, file, titleOverride) {
  const path = resolve(file);
  const size = statSync(path).size;
  const mimeType = mimeFor(path);
  const duration = durationSeconds(path);
  const name = titleOverride ?? basename(path, extname(path));

  console.log(`\n[${basename(path)}] ${(size / 1e6).toFixed(1)} MB, ${duration.toFixed(1)} s, ${mimeType}`);

  const start = await api(token, "/api/recordings/start", {
    type: "video",
    tracks: [{ kind: "composite", mimeType }],
    brandProfileId: null,
    title: name,
  });
  console.log(`  started recording ${start.recordingId} (slug ${start.slug})`);

  const partCount = Math.ceil(size / PART_SIZE);
  const parts = [];
  const fd = openSync(path, "r");
  try {
    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      const offset = (partNumber - 1) * PART_SIZE;
      const len = Math.min(PART_SIZE, size - offset);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, offset);
      const { url } = await api(token, `/api/recordings/${start.recordingId}/part-url`, {
        track: "composite",
        partNumber,
      });
      const etag = await putWithRetry(url, buf);
      parts.push({ PartNumber: partNumber, ETag: etag });
      process.stdout.write(`  part ${partNumber}/${partCount} ok\r`);
    }
  } finally {
    closeSync(fd);
  }
  process.stdout.write("\n");

  const done = await api(token, `/api/recordings/${start.recordingId}/complete`, {
    tracks: { composite: parts },
    durationSeconds: duration,
  });
  const share = `${appUrl}/v/${done.slug}`;
  console.log(`  share:  ${share}`);
  console.log(`  edit:   ${appUrl}/recordings/${start.recordingId}/edit`);
  return { file: basename(path), share, recordingId: start.recordingId };
}

const token = await signIn();
console.log(`signed in as ${TEST_CREATOR_EMAIL} -> ${appUrl}`);
const results = [];
for (const f of files) results.push(await uploadOne(token, f, title));
console.log("\nDone:");
for (const r of results) console.log(`  ${r.file}  ->  ${r.share}`);
