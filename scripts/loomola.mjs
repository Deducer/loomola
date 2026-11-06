#!/usr/bin/env node
// Loomola agent CLI — a thin client over the Loomola MCP server, for
// shell-only agents and for the one thing MCP can't do on its own: read a
// local video file and PUT its bytes to R2.
//
//   node scripts/loomola.mjs upload <file> [--title T] [--brand NAME|ID] [--wait]
//   node scripts/loomola.mjs brands
//   node scripts/loomola.mjs set-brand <recording> <NAME|ID|none>
//   node scripts/loomola.mjs status <recording> [--wait]
//   node scripts/loomola.mjs get <recording> [--transcript]
//   node scripts/loomola.mjs comments <recording>
//   node scripts/loomola.mjs comment <recording> "text" [--at 1:23] [--name N]
//   node scripts/loomola.mjs delete-comment <commentId>
//   node scripts/loomola.mjs trash <recording>
//   node scripts/loomola.mjs tools
//   node scripts/loomola.mjs call <tool> '<json args>'
//
// <recording> is a recording id, slug, or share URL.
// Output is JSON on stdout; progress goes to stderr.
//
// Auth: the MCP bearer token, from LOOMOLA_MCP_TOKEN / MCP_TOKEN, else read
// from Doppler (dissonance-cloud / prd_loom, MCP_TOKEN). It is never printed.
// Server: LOOMOLA_URL (default https://loom.dissonance.cloud).

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const BASE = (process.env.LOOMOLA_URL ?? "https://loom.dissonance.cloud").replace(/\/$/, "");
const DOPPLER_PROJECT = process.env.LOOMOLA_DOPPLER_PROJECT ?? "dissonance-cloud";
const DOPPLER_CONFIG = process.env.LOOMOLA_DOPPLER_CONFIG ?? "prd_loom";
const PUT_CONCURRENCY = 4;

function fail(message, extra) {
  process.stdout.write(JSON.stringify({ error: message, ...extra }, null, 2) + "\n");
  process.exit(1);
}

function token() {
  const fromEnv = process.env.LOOMOLA_MCP_TOKEN ?? process.env.MCP_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const t = execFileSync(
      "doppler",
      ["secrets", "get", "MCP_TOKEN", "--plain", "--project", DOPPLER_PROJECT, "--config", DOPPLER_CONFIG],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (t) return t;
  } catch {
    // fall through
  }
  fail("no MCP token: set LOOMOLA_MCP_TOKEN or sign in to the Doppler CLI (dissonance-cloud/prd_loom)");
}

let rpcId = 0;
let cachedToken;
async function rpc(method, params) {
  cachedToken ??= token();
  let res;
  try {
    res = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cachedToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    fail(`cannot reach ${BASE}/api/mcp: ${e.cause?.code ?? e.message}`);
  }
  if (!res.ok) fail(`MCP HTTP ${res.status}${res.status === 401 ? " (token rejected)" : ""}`);
  const json = await res.json();
  if (json.error) fail(`MCP error: ${json.error.message}`, { code: json.error.code });
  return json.result;
}

async function call(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text ?? "null";
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = { text };
  }
  if (result?.isError) fail(value?.message ?? `${name} failed`, value);
  return value;
}

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else flags[key] = argv[++i];
    } else positional.push(a);
  }
  return { positional, flags };
}

/** "83", "83.5", "1:23", "1:02:03" -> seconds. */
function parseTimestamp(raw) {
  if (raw === undefined || raw === true) return 0;
  const parts = String(raw).split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) fail(`bad timestamp "${raw}" (use 83 or 1:23)`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function durationSeconds(file) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { encoding: "utf8" }
    );
    const d = parseFloat(out.trim());
    if (Number.isFinite(d) && d > 0) return d;
  } catch {
    // fall through
  }
  fail(`ffprobe could not read the duration of ${file} (is ffprobe installed?)`);
}

async function putPart(url, buf, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { method: "PUT", body: buf, signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
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

async function waitForReady(recording, timeoutSec = 900) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutSec * 1000) {
    last = await call("loomola_recording_status", { recording });
    if (last.status === "ready" || last.status === "failed") return last;
    process.stderr.write(`  status: ${last.status}\n`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return { ...last, timedOut: true };
}

async function upload(file, flags) {
  const path = resolve(file);
  if (!existsSync(path) || !statSync(path).isFile()) fail(`no such file: ${path}`);
  const size = statSync(path).size;
  const duration = durationSeconds(path);

  const begin = await call("loomola_upload_begin", {
    filename: basename(path),
    sizeBytes: size,
    ...(typeof flags.title === "string" ? { title: flags.title } : {}),
    ...(typeof flags.brand === "string" ? { brand: flags.brand } : {}),
  });
  process.stderr.write(
    `uploading ${basename(path)} (${(size / 1e6).toFixed(1)} MB, ${duration.toFixed(1)} s) as ${begin.slug}` +
      (begin.brand ? ` under brand "${begin.brand.name}"` : "") +
      ` in ${begin.partCount} part(s)\n`
  );

  const etags = new Array(begin.partCount);
  const fd = openSync(path, "r");
  try {
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < begin.parts.length) {
        const { partNumber, url } = begin.parts[next++];
        const offset = (partNumber - 1) * begin.partSize;
        const len = Math.min(begin.partSize, size - offset);
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, offset);
        etags[partNumber - 1] = { partNumber, etag: await putPart(url, buf) };
        process.stderr.write(`  part ${++done}/${begin.partCount}\r`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PUT_CONCURRENCY, begin.partCount) }, worker));
    process.stderr.write("\n");
  } catch (e) {
    // Don't leave a half-uploaded row on the dashboard.
    await call("loomola_trash_recording", { recording: begin.recordingId }).catch(() => {});
    fail(`upload failed, recording ${begin.recordingId} moved to trash: ${e.message}`);
  } finally {
    closeSync(fd);
  }

  const done = await call("loomola_upload_complete", {
    recordingId: begin.recordingId,
    durationSeconds: duration,
    parts: etags,
  });
  const result = { ...done, brand: begin.brand };
  if (flags.wait) result.final = await waitForReady(begin.recordingId);
  print(result);
}

const [command, ...rest] = process.argv.slice(2);
const { positional, flags } = parseFlags(rest);
const need = (n, usage) => {
  if (positional.length < n) fail(`usage: loomola ${usage}`);
};

switch (command) {
  case "upload":
    need(1, "upload <file> [--title T] [--brand NAME|ID] [--wait]");
    await upload(positional[0], flags);
    break;
  case "brands":
    print(await call("loomola_list_brands"));
    break;
  case "set-brand": {
    need(2, "set-brand <recording> <NAME|ID|none>");
    const brand = positional[1].toLowerCase() === "none" ? null : positional[1];
    print(await call("loomola_set_brand", { recording: positional[0], brand }));
    break;
  }
  case "status":
    need(1, "status <recording> [--wait]");
    print(flags.wait ? await waitForReady(positional[0]) : await call("loomola_recording_status", { recording: positional[0] }));
    break;
  case "get":
    need(1, "get <recording> [--transcript]");
    print(
      await call("loomola_get_media", {
        idOrSlug: positional[0],
        include: flags.transcript ? ["transcript", "chapters", "actionItems", "comments"] : ["chapters", "actionItems", "comments"],
      })
    );
    break;
  case "comments":
    need(1, "comments <recording>");
    print(await call("loomola_list_comments", { recording: positional[0] }));
    break;
  case "comment":
    need(2, 'comment <recording> "text" [--at 1:23] [--name N]');
    print(
      await call("loomola_post_comment", {
        recording: positional[0],
        body: positional[1],
        timestampSec: parseTimestamp(flags.at),
        ...(typeof flags.name === "string" ? { name: flags.name } : {}),
      })
    );
    break;
  case "delete-comment":
    need(1, "delete-comment <commentId>");
    print(await call("loomola_delete_comment", { commentId: positional[0] }));
    break;
  case "trash":
    need(1, "trash <recording>");
    print(await call("loomola_trash_recording", { recording: positional[0] }));
    break;
  case "tools": {
    const { tools } = await rpc("tools/list", {});
    print(tools.map((t) => ({ name: t.name, description: t.description })));
    break;
  }
  case "call":
    need(1, "call <tool> '<json args>'");
    print(await call(positional[0], positional[1] ? JSON.parse(positional[1]) : {}));
    break;
  default:
    process.stderr.write(
      "usage: node scripts/loomola.mjs <upload|brands|set-brand|status|get|comments|comment|delete-comment|trash|tools|call> ...\n"
    );
    process.exit(2);
}
