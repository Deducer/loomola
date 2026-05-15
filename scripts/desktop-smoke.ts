import { execFileSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

type StoredAuthSession = {
  accessToken?: string;
  refreshToken?: string;
};

type DesktopConfig = {
  apiBaseURL: string;
  supabaseURL: string;
  anonKey: string;
  buildCommit: string;
  buildDate: string;
};

type RecentItem = {
  id: string;
  title: string | null;
  kind: "video" | "audio";
  status: string;
};

const args = new Set(process.argv.slice(2));
const appPath = process.env.LOOM_DESKTOP_APP_PATH ?? "/Applications/Loomola.app";
const fixtureId =
  process.env.LOOM_DESKTOP_SMOKE_NOTE_ID ??
  "201803ac-6288-4197-ad5a-bd0dccc986a1";
const fixtureTitle =
  process.env.LOOM_DESKTOP_SMOKE_NOTE_TITLE ??
  "Documentary film weekly team meeting — imagery, voice, and reviewer feedback";
const authSessionPath =
  process.env.LOOM_DESKTOP_AUTH_SESSION_PATH ??
  path.join(homedir(), "Library/Application Support/LoomDesktop/auth-session.json");
const shouldWrite = args.has("--write") || process.env.LOOM_DESKTOP_SMOKE_WRITE === "1";
const shouldCapture = args.has("--capture-window");

let stepIndex = 0;

async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  stepIndex += 1;
  const startedAt = Date.now();
  try {
    const result = await fn();
    console.log(`  ✓ ${stepIndex}. ${name} (${Date.now() - startedAt}ms)`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ ${stepIndex}. ${name} (${Date.now() - startedAt}ms): ${message}`);
    throw error;
  }
}

function run(command: string, args: string[], input?: string): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    input,
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  }).trim();
}

function readPlistValue(plistPath: string, key: string): string {
  return run("plutil", ["-extract", key, "raw", "-o", "-", plistPath]);
}

function decodeJwtPayload(token: string): { exp?: number; email?: string } {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("access token is not a JWT");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function isTableMarkdown(markdown: string): boolean {
  return /(^|\n)\s*\|[^|\n]+\|[^\n]*\n\s*\|[\s:|-]+\|/.test(markdown);
}

function hasHorizontalRule(markdown: string): boolean {
  return /(^|\n)\s*---+\s*(\n|$)/.test(markdown);
}

function hasDoubledBold(markdown: string): boolean {
  return /\*{4}[^*\n]+?\*{4}/.test(markdown);
}

function windowProbeScript(): string {
  return `
import Foundation
import CoreGraphics

let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
let matches = windows.compactMap { window -> [String: Any]? in
    guard (window[kCGWindowOwnerName as String] as? String) == "Loomola" else { return nil }
    guard (window[kCGWindowIsOnscreen as String] as? Bool) == true else { return nil }
    guard (window[kCGWindowLayer as String] as? Int) == 0 else { return nil }
    return [
        "number": window[kCGWindowNumber as String] ?? 0,
        "name": window[kCGWindowName as String] ?? "",
        "bounds": window[kCGWindowBounds as String] ?? [:]
    ]
}
let data = try JSONSerialization.data(withJSONObject: matches, options: [])
print(String(data: data, encoding: .utf8)!)
`;
}

function getOnscreenLoomolaWindows(): Array<{
  number: number;
  name: string;
  bounds: Record<string, number>;
}> {
  const output = run("swift", ["-"], windowProbeScript());
  return JSON.parse(output);
}

async function readConfig(): Promise<DesktopConfig> {
  const plistPath = path.join(appPath, "Contents/Resources/DesktopConfig.plist");
  return {
    apiBaseURL: readPlistValue(plistPath, "LOOM_API_BASE_URL"),
    supabaseURL: readPlistValue(plistPath, "LOOM_SUPABASE_URL"),
    anonKey: readPlistValue(plistPath, "LOOM_SUPABASE_ANON_KEY"),
    buildCommit: readPlistValue(plistPath, "LOOM_BUILD_COMMIT"),
    buildDate: readPlistValue(plistPath, "LOOM_BUILD_DATE"),
  };
}

async function readStoredSession(): Promise<StoredAuthSession> {
  const raw = await readFile(authSessionPath, "utf8");
  return JSON.parse(raw);
}

async function refreshSessionIfNeeded(
  config: DesktopConfig,
  session: StoredAuthSession
): Promise<StoredAuthSession> {
  if (!session.accessToken) throw new Error(`missing accessToken in ${authSessionPath}`);
  if (!session.refreshToken) throw new Error(`missing refreshToken in ${authSessionPath}`);

  const claims = decodeJwtPayload(session.accessToken);
  const expiresAtMs = (claims.exp ?? 0) * 1000;
  if (expiresAtMs - Date.now() > 5 * 60 * 1000) {
    return session;
  }

  const response = await fetch(`${config.supabaseURL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${config.anonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`refresh failed: HTTP ${response.status} ${body.slice(0, 180)}`);
  }
  const refreshed = JSON.parse(body) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!refreshed.access_token || !refreshed.refresh_token) {
    throw new Error("refresh response did not include both tokens");
  }

  const nextSession = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
  };
  await writeFile(authSessionPath, `${JSON.stringify(nextSession, null, 2)}\n`);
  await chmod(authSessionPath, 0o600);
  return nextSession;
}

async function apiJson<T>(
  config: DesktopConfig,
  token: string,
  pathname: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${config.apiBaseURL}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    throw new Error(
      `${pathname} returned non-JSON HTTP ${response.status} (${contentType}): ${text.slice(0, 160)}`
    );
  }
  const body = JSON.parse(text);
  if (!response.ok) {
    throw new Error(`${pathname} failed HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return body as T;
}

async function main() {
  console.log(`[desktop-smoke] app: ${appPath}`);
  console.log(`[desktop-smoke] mode: ${shouldWrite ? "write" : "read-only"}`);

  const config = await step("read installed DesktopConfig.plist", readConfig);

  await step("installed build stamp matches current HEAD prefix", () => {
    const head = run("git", ["rev-parse", "--short", "HEAD"]);
    if (!config.buildCommit.startsWith(head)) {
      throw new Error(`bundle=${config.buildCommit}; HEAD=${head}`);
    }
    console.log(`    bundle=${config.buildCommit} built=${config.buildDate}`);
  });

  await step("launch Loomola and find an onscreen CoreGraphics window", async () => {
    run("open", [appPath]);
    const deadline = Date.now() + 15_000;
    let windows = getOnscreenLoomolaWindows();
    while (windows.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      windows = getOnscreenLoomolaWindows();
    }
    if (windows.length !== 1) {
      throw new Error(`expected exactly 1 onscreen Loomola window, found ${windows.length}`);
    }
    const [window] = windows;
    console.log(`    window=${window.number} ${JSON.stringify(window.bounds)}`);
    if (shouldCapture) {
      const outPath = "/tmp/loomola-desktop-smoke.png";
      run("screencapture", ["-x", "-l", String(window.number), outPath]);
      console.log(`    captured=${outPath}`);
    }
  });

  const session = await step("load and refresh saved desktop auth session", async () => {
    const stored = await readStoredSession();
    const refreshed = await refreshSessionIfNeeded(config, stored);
    const claims = decodeJwtPayload(refreshed.accessToken ?? "");
    if (!claims.exp || claims.exp * 1000 <= Date.now()) {
      throw new Error("access token is still expired after refresh check");
    }
    console.log(`    email=${claims.email ?? "unknown"} exp=${new Date(claims.exp * 1000).toISOString()}`);
    return refreshed;
  });
  const token = session.accessToken ?? "";

  await step("production health endpoint returns JSON, not login HTML", async () => {
    const body = await apiJson<{
      app: string;
      buildTime: string;
      environment: string;
    }>(config, token, "/api/health/version");
    if (body.app !== "loomola") throw new Error(`unexpected app=${body.app}`);
    console.log(`    production build=${body.buildTime} env=${body.environment}`);
  });

  await step("recent video and audio endpoints return JSON", async () => {
    const [videos, notes] = await Promise.all([
      apiJson<{ items: RecentItem[] }>(config, token, "/api/recordings/recent?limit=5&kind=video"),
      apiJson<{ items: RecentItem[] }>(config, token, "/api/recordings/recent?limit=50&kind=audio"),
    ]);
    if (!Array.isArray(videos.items)) throw new Error("video recents missing items[]");
    if (!Array.isArray(notes.items)) throw new Error("audio recents missing items[]");
    console.log(`    videos=${videos.items.length} audio=${notes.items.length}`);
  });

  const fixture = await step("known documentary note keeps its manual title", async () => {
    const notes = await apiJson<{ items: RecentItem[] }>(
      config,
      token,
      "/api/recordings/recent?limit=50&kind=audio"
    );
    const item = notes.items.find((candidate) => candidate.id === fixtureId);
    if (!item) throw new Error(`fixture note ${fixtureId} not found in recent audio items`);
    if (item.title !== fixtureTitle) {
      throw new Error(`fixture title changed: ${JSON.stringify(item.title)}`);
    }
    return item;
  });

  await step("known documentary enhanced notes are readable markdown", async () => {
    const body = await apiJson<{
      summary: string | null;
      generationStatus: string;
      transcriptReady: boolean;
    }>(config, token, `/api/notes/${fixture.id}/enhance`);
    if (body.generationStatus !== "complete") {
      throw new Error(`generationStatus=${body.generationStatus}`);
    }
    if (!body.transcriptReady) throw new Error("transcriptReady=false");
    const summary = body.summary ?? "";
    if (summary.length < 1000) throw new Error(`summary too short: ${summary.length} chars`);
    if (isTableMarkdown(summary)) throw new Error("summary still contains a markdown table");
    if (hasHorizontalRule(summary)) throw new Error("summary still contains a horizontal rule");
    if (hasDoubledBold(summary)) throw new Error("summary still contains doubled bold markers");
    console.log(`    summaryChars=${summary.length}`);
  });

  if (shouldWrite) {
    await step("PATCH same title succeeds with desktop Bearer token", async () => {
      const body = await apiJson<{ ok: boolean }>(config, token, `/api/recordings/${fixture.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: fixtureTitle }),
      });
      if (body.ok !== true) throw new Error(`unexpected response ${JSON.stringify(body)}`);
    });
  }
}

void (async () => {
  try {
    const startedAt = Date.now();
    await main();
    console.log(`[desktop-smoke] passed ${stepIndex} checks in ${Date.now() - startedAt}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[desktop-smoke] FAILED: ${message}`);
    process.exit(1);
  }
})();
