# OSS Readiness Phase 5 — Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loomola becomes installable without editing source: the Chrome extension gets an options page (and first-run popup prompt) that points it at any self-hosted origin while Ian's install keeps working with zero action; a `v*` tag produces a signed + notarized + stapled `.dmg` on a GitHub Release (degrading to a clearly-named `-unsigned` zip until Apple secrets land); the web image publishes to `ghcr.io/deducer/loomola` with the NEXT_PUBLIC build-time constraint documented honestly (compose keeps `build: .` as the supported path); and release plumbing (version sync, CHANGELOG convention, one-Release-per-tag assembly) is in place so tagging `v1.0.0` at the end of Phase 6 is a one-command act.

**Architecture:** The extension already requires `<all_urls>` host permissions and already runs `content-script-page.js` (the bubble injector) on every URL — the **only** origin-pinned wiring is the static `content_scripts` entry for `content-script-app.js` (the app↔extension bridge), two `chrome.tabs.query({url})` calls in `background.js`, and the popup link. So the configurable-origin design is: a pure `extension/lib/origin-utils.js` module (unit-tested from the existing Vitest suite), a `chrome.storage.sync` key `appOrigin` (unset ⇒ default `https://loom.dissonance.cloud`, byte-identical behavior for Ian), and **`chrome.scripting.registerContentScripts` dynamic registration** of the app bridge for non-default origins — the static manifest entry for the default origin stays, so the default path never touches the dynamic API. **Spec deviation, deliberate:** the spec proposed `optional_host_permissions` + `chrome.permissions.request`, but the shipped manifest already requires `<all_urls>` because the bubble must inject into *any* tab being recorded — adding an optional grant for the app origin would be a second prompt that reduces nothing; dynamic registration is already authorized by the existing `<all_urls>` grant, so there is **no runtime permission flow**. The desktop workflow reuses `desktop/scripts/build-dev-app.sh` (release config) then re-signs with Developer ID + hardened runtime, notarizes the DMG via `notarytool` with an App Store Connect API key, and staples; public Supabase client config is baked from repo **variables** (`LOOM_SUPABASE_URL`/`LOOM_SUPABASE_ANON_KEY`/`LOOM_API_BASE_URL`) so forks produce DMGs for their own instance — there is no runtime server-picker in the app (`DesktopAuthConfiguration.fromEnvironment` throws without bundled config; Finder launches carry no shell env), and the plan documents that honestly rather than inventing one. The GHCR image is built with the same placeholder NEXT_PUBLIC values CI already proves green — `src/lib/supabase/client.ts` calls `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, …)` and Next.js inlines `NEXT_PUBLIC_*` into the bundles at build time with **no runtime bootstrap endpoint anywhere in the codebase** — so the prebuilt image cannot do browser auth and is positioned as build-cache + fork-bake base, with compose `build: .` remaining primary (it already is). Both tag-triggered workflows attach artifacts to one GitHub Release via `softprops/action-gh-release@v2`, which updates an existing release and appends files (the race is benign; a rare API conflict is fixed by re-running the job).

**Tech stack:** Chrome MV3 (`chrome.scripting.registerContentScripts`, `chrome.storage.sync`, ES-module service worker), GitHub Actions (`macos-14` + Xcode 16.x for the Swift 6 toolchain `Package.swift` requires; `ubuntu-latest` for Docker), `security`/`codesign`/`xcrun notarytool`/`xcrun stapler`/`hdiutil`, `docker/build-push-action@v6` + `docker/metadata-action@v5`, `softprops/action-gh-release@v2`, Vitest (`tests/unit`).

**Spec:** `docs/superpowers/specs/2026-06-09-open-source-readiness-design.md` — Phase 5, items 5.1–5.4.

**⚠️ Working-tree warning:** The tree is clean as of planning time, but verify with `git status --short` before starting. NEVER `git add -A` or `git add .` — stage only the files named in each task's commit step. **NEVER push — the controller pushes.** (This differs from the Phase 3 plan, which pushed; Phase 5 lands as commits only.)

**Verification constraints (read before starting):** Extension work is verifiable locally only by code-reading, `node --input-type=module --check`, manifest JSON validation, and unit tests on the pure module — no browser automation. Ian dogfoods per the **extension reload protocol** (CLAUDE.md line 105: bump the manifest version, reload at `chrome://extensions`, close tabs from the previous extension lifetime); each extension task ends with a manual checklist for him. Workflows are verified by YAML-parse (`node_modules/js-yaml` is available) + careful review; the desktop workflow additionally supports a `workflow_dispatch` dry run that skips signing and the Release, so Ian can validate the full build+package path on a runner without any secrets.

**Task ordering:** Tasks are independent and individually committable. Task 4 (version sync) must land before any `v*` tag is ever pushed — and **the `v1.0.0` tag itself is explicitly deferred to the end of Phase 6**; nothing in this phase creates a tag.

---

### Task 1: Configurable Chrome extension origin (spec 5.1)

**Files:**
- Create: `extension/lib/origin-utils.js` (pure — no `chrome.*`)
- Create: `extension/lib/origin-utils.d.ts` (so the TS test compiles with `allowJs: false`)
- Create: `extension/lib/app-origin.js` (storage accessors)
- Create: `extension/options.html`, `extension/options.js`
- Modify: `extension/manifest.json` (version bump, de-instanced description, drop redundant host permission, `options_ui`)
- Modify: `extension/background.js` (origin-driven tab queries; dynamic registration sync)
- Modify: `extension/popup.html`, `extension/popup.js` (dynamic link, first-run prompt)
- Modify: `extension/content-script-app.js` (header comment only)
- Modify: `extension/README.md` (replace the perl-substitution instructions)
- Test: `tests/unit/extension-origin-utils.test.ts`

Current state being changed: `manifest.json` pins `content-script-app.js` to `https://loom.dissonance.cloud/*` (the page script already matches `<all_urls>`); `background.js` lines 174 and 193 hardcode `url: "https://loom.dissonance.cloud/*"` in `chrome.tabs.query`; `popup.html` lines 96–98 hardcode the `/record` link. `NATIVE_HOST_NAME = "com.dissonance.loom_desktop"` in `background.js` is **not** origin-dependent (it's the native-messaging host id registered by `desktop/scripts/install-native-messaging-host.sh`) and stays as-is. `content-script-app.js` itself contains no origin reference — it is gated purely by where it's registered, which is exactly why dynamic registration is a zero-code-change path for it (its synchronous `dataset.loomCloneExtension = "1"` marker, which `src/components/record/extension-status.tsx:17` reads, keeps working identically).

**Match-pattern subtlety (load-bearing):** Chrome match patterns may not contain ports, and a pattern matches that host on *any* port. Both `chrome.scripting.registerContentScripts({matches})` and `chrome.tabs.query({url})` take match patterns. So we store the full origin (with port, for the popup link and user display) and derive the pattern by stripping the port (`http://localhost:3000` → `http://localhost/*`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/extension-origin-utils.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_ORIGIN,
  normalizeAppOrigin,
  originToMatchPattern,
} from "../../extension/lib/origin-utils.js";

describe("normalizeAppOrigin", () => {
  it("normalizes bare domains to https origins and strips paths", () => {
    expect(normalizeAppOrigin("loomola.example.com")).toBe(
      "https://loomola.example.com"
    );
    expect(normalizeAppOrigin("  https://loomola.example.com/record  ")).toBe(
      "https://loomola.example.com"
    );
  });

  it("keeps explicit ports in the origin", () => {
    expect(normalizeAppOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000"
    );
  });

  it("allows http only for loopback hosts", () => {
    expect(normalizeAppOrigin("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000"
    );
    expect(normalizeAppOrigin("http://loomola.example.com")).toBeNull();
  });

  it("rejects junk without throwing", () => {
    expect(normalizeAppOrigin("")).toBeNull();
    expect(normalizeAppOrigin("   ")).toBeNull();
    expect(normalizeAppOrigin("chrome://extensions")).toBeNull();
    expect(normalizeAppOrigin(null)).toBeNull();
    expect(normalizeAppOrigin(42)).toBeNull();
    expect(normalizeAppOrigin("not a url !!")).toBeNull();
  });

  it("default origin remains Ian's instance", () => {
    expect(DEFAULT_APP_ORIGIN).toBe("https://loom.dissonance.cloud");
  });
});

describe("originToMatchPattern", () => {
  it("appends /* to a plain origin", () => {
    expect(originToMatchPattern("https://loom.dissonance.cloud")).toBe(
      "https://loom.dissonance.cloud/*"
    );
  });

  it("strips ports — Chrome match patterns cannot contain them (and match any port)", () => {
    expect(originToMatchPattern("http://localhost:3000")).toBe(
      "http://localhost/*"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/extension-origin-utils.test.ts`
Expected: FAIL — cannot resolve `../../extension/lib/origin-utils.js`.

- [ ] **Step 3: Create `extension/lib/origin-utils.js`**

```javascript
/**
 * Pure origin helpers for the configurable app origin — no chrome.* so the
 * web repo's Vitest suite can unit-test them directly
 * (tests/unit/extension-origin-utils.test.ts).
 */

export const DEFAULT_APP_ORIGIN = "https://loom.dissonance.cloud";

function isLoopbackHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Normalizes user input ("my-loomola.com", "https://x.com/record ") to a
 * bare origin, or null when unusable. http is allowed for loopback hosts
 * only — everything else must be https (the recorder needs a secure
 * context anyway).
 */
export function normalizeAppOrigin(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) {
    return url.origin;
  }
  return null;
}

/**
 * Chrome match patterns (used by both scripting.registerContentScripts and
 * tabs.query({url})) may NOT contain ports — a pattern matches the host on
 * any port. Strip the port; keep the full origin for display/links.
 */
export function originToMatchPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}
```

- [ ] **Step 4: Create `extension/lib/origin-utils.d.ts`**

(`tsconfig.json` has `allowJs: false`, so the TS test needs declarations; `moduleResolution: "bundler"` resolves the sibling `.d.ts`.)

```typescript
export const DEFAULT_APP_ORIGIN: string;
export function normalizeAppOrigin(raw: unknown): string | null;
export function originToMatchPattern(origin: string): string;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/extension-origin-utils.test.ts`
Expected: PASS (7 tests). Also `npm run typecheck` — green (proves the `.d.ts` wiring).

- [ ] **Step 6: Create `extension/lib/app-origin.js`**

```javascript
/**
 * chrome.storage.sync-backed app-origin accessors. Used by the background
 * service worker, the options page, and the popup (all ES-module contexts).
 * Content scripts never need this — they're gated by where they're
 * registered, not by reading the origin themselves.
 */
import { DEFAULT_APP_ORIGIN, normalizeAppOrigin } from "./origin-utils.js";

export const APP_ORIGIN_STORAGE_KEY = "appOrigin";

/** Resolved origin: stored value when valid, else the default. Never throws. */
export async function getAppOrigin() {
  try {
    const result = await chrome.storage.sync.get(APP_ORIGIN_STORAGE_KEY);
    return normalizeAppOrigin(result[APP_ORIGIN_STORAGE_KEY]) ?? DEFAULT_APP_ORIGIN;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

/** Whether the user has ever set an origin (drives the first-run prompt). */
export async function hasStoredAppOrigin() {
  try {
    const result = await chrome.storage.sync.get(APP_ORIGIN_STORAGE_KEY);
    return typeof result[APP_ORIGIN_STORAGE_KEY] === "string";
  } catch {
    return false;
  }
}

/** Normalizes and stores; throws on invalid input (callers show the error). */
export async function setAppOrigin(raw) {
  const normalized = normalizeAppOrigin(raw);
  if (!normalized) {
    throw new Error(
      "Enter your Loomola URL, e.g. https://loomola.example.com (http allowed for localhost only)."
    );
  }
  await chrome.storage.sync.set({ [APP_ORIGIN_STORAGE_KEY]: normalized });
  return normalized;
}

/** Clears the stored origin — back to the default instance. */
export async function clearAppOrigin() {
  await chrome.storage.sync.remove(APP_ORIGIN_STORAGE_KEY);
}

export { DEFAULT_APP_ORIGIN };
```

- [ ] **Step 7: Update `extension/manifest.json`**

Three changes, leaving everything else (including the `key` field that pins the stable extension ID `fhlommkndlhemikefocglkknpofgkfkj`) untouched:

1. `"version": "0.8.0"` → `"version": "0.9.0"` (reload protocol: the bump is what makes the reload visible at `chrome://extensions`).
2. `"description"` → `"Companion extension for Loomola. Injects a frameless, draggable camera bubble into the tab being recorded — true Loom-parity polish that the browser's documentPictureInPicture window can't deliver alone. Point it at your own Loomola instance from the options page."`
3. `"host_permissions"` → `["<all_urls>"]` (the explicit `https://loom.dissonance.cloud/*` entry was always redundant with `<all_urls>`, which the bubble model requires; removing it is what makes the manifest origin-free). Keep `content_scripts` exactly as-is — the static `https://loom.dissonance.cloud/*` entry for `content-script-app.js` is the default-origin fast path that never depends on the dynamic API.
4. Add, after the `"action"` block:

```json
  "options_ui": {
    "page": "options.html",
    "open_in_tab": false
  },
```

- [ ] **Step 8: Update `extension/background.js`**

At the top (the service worker is `"type": "module"`), after the existing constants, add:

```javascript
import { getAppOrigin, DEFAULT_APP_ORIGIN } from "./lib/app-origin.js";
import { originToMatchPattern } from "./lib/origin-utils.js";

/** Id for the dynamically-registered app-bridge content script (used only
 * when a non-default origin is configured; the static manifest entry covers
 * the default origin). */
const APP_SCRIPT_ID = "loomola-app-bridge";

async function appUrlPattern() {
  return originToMatchPattern(await getAppOrigin());
}

/**
 * Keeps the dynamic registration of content-script-app.js in sync with the
 * configured origin. Default origin → no dynamic script (the static
 * manifest entry already covers it — zero behavior change for the default
 * install). Custom origin → register/update the bridge for that origin.
 * Authorized by the manifest's required <all_urls> host permission, so no
 * chrome.permissions.request flow is needed. persistAcrossSessions keeps
 * the registration across browser restarts; onStartup/onInstalled re-syncs
 * are self-healing belt-and-braces.
 */
async function syncAppContentScript() {
  try {
    const origin = await getAppOrigin();
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [APP_SCRIPT_ID],
    });
    if (origin === DEFAULT_APP_ORIGIN) {
      if (existing.length > 0) {
        await chrome.scripting.unregisterContentScripts({ ids: [APP_SCRIPT_ID] });
        console.log("[loom-clone-ext:bg] app bridge back on default origin");
      }
      return;
    }
    const script = {
      id: APP_SCRIPT_ID,
      matches: [originToMatchPattern(origin)],
      js: ["content-script-app.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    };
    if (existing.length > 0) {
      await chrome.scripting.updateContentScripts([script]);
    } else {
      await chrome.scripting.registerContentScripts([script]);
    }
    console.log(`[loom-clone-ext:bg] app bridge registered for ${origin}`);
  } catch (err) {
    console.error("[loom-clone-ext:bg] syncAppContentScript failed:", err);
  }
}

chrome.runtime.onInstalled.addListener(() => void syncAppContentScript());
chrome.runtime.onStartup.addListener(() => void syncAppContentScript());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.appOrigin) void syncAppContentScript();
});
```

Then replace the two hardcoded tab queries:

In `forwardPositionToApp` (currently line ~174):
```javascript
  const tabs = await chrome.tabs.query({ url: await appUrlPattern() });
```
In `forwardMeetingSignalToApp` (currently line ~193):
```javascript
  const tabs = await chrome.tabs.query({ url: await appUrlPattern() });
```

Also update the `isInjectableTab` doc comment's `loom.dissonance.cloud` mention to "the Loomola app origin" (comment-only).

- [ ] **Step 9: Create `extension/options.html` and `extension/options.js`**

```html
<!-- extension/options.html -->
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Loomola — Options</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        width: 320px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
          sans-serif;
        font-size: 13px;
        background: #0b0b0c;
        color: #e5e5e5;
      }
      h1 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
      p { margin: 0 0 12px; color: #a1a1aa; line-height: 1.5; }
      label { display: block; margin-bottom: 6px; color: #a1a1aa; }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid #3f3f46;
        background: #18181b;
        color: #e5e5e5;
        font-size: 13px;
      }
      .row { display: flex; gap: 8px; margin-top: 10px; }
      button {
        padding: 6px 12px;
        border-radius: 6px;
        border: none;
        background: #7c3aed;
        color: #fff;
        font-size: 13px;
        cursor: pointer;
      }
      button.secondary { background: #27272a; color: #a1a1aa; }
      #status { margin-top: 10px; font-size: 12px; min-height: 16px; }
      #status.ok { color: #86efac; }
      #status.error { color: #fca5a5; }
    </style>
  </head>
  <body>
    <h1>Loomola instance</h1>
    <p>
      The web app this extension talks to. Leave blank to use the default
      instance.
    </p>
    <label for="origin">App origin</label>
    <input id="origin" type="text" placeholder="https://loom.dissonance.cloud"
      spellcheck="false" autocomplete="off" />
    <div class="row">
      <button id="save" type="button">Save</button>
      <button id="reset" type="button" class="secondary">Use default</button>
    </div>
    <p id="status"></p>
    <script type="module" src="options.js"></script>
  </body>
</html>
```

```javascript
// extension/options.js
import {
  DEFAULT_APP_ORIGIN,
  getAppOrigin,
  hasStoredAppOrigin,
  setAppOrigin,
  clearAppOrigin,
} from "./lib/app-origin.js";

const input = document.getElementById("origin");
const statusEl = document.getElementById("status");

function showStatus(message, ok) {
  statusEl.textContent = message;
  statusEl.className = ok ? "ok" : "error";
}

async function load() {
  if (await hasStoredAppOrigin()) {
    input.value = await getAppOrigin();
  }
  input.placeholder = DEFAULT_APP_ORIGIN;
}

document.getElementById("save").addEventListener("click", async () => {
  const raw = input.value.trim();
  try {
    if (!raw) {
      await clearAppOrigin();
      showStatus(`Using the default: ${DEFAULT_APP_ORIGIN}`, true);
      return;
    }
    const saved = await setAppOrigin(raw);
    input.value = saved;
    // The background worker re-registers the app bridge via its
    // storage.onChanged listener; already-open app tabs need a reload.
    showStatus(`Saved: ${saved} — reload your Loomola tab.`, true);
  } catch (err) {
    showStatus(err?.message ?? "Invalid URL.", false);
  }
});

document.getElementById("reset").addEventListener("click", async () => {
  await clearAppOrigin();
  input.value = "";
  showStatus(`Using the default: ${DEFAULT_APP_ORIGIN}`, true);
});

void load();
```

- [ ] **Step 10: Update the popup**

In `extension/popup.html`, replace the hardcoded paragraph (lines 94–99) with:

```html
    <p id="first-run" hidden>
      Self-hosting Loomola? <a href="#" id="open-options">Set your instance URL</a>
      — otherwise the default works as-is.
    </p>
    <p>
      Start a recording at
      <a id="record-link" href="https://loom.dissonance.cloud/record" target="_blank"
        >your Loomola</a
      >. The bubble will appear automatically in whichever tab you record.
    </p>
    <p class="muted"><a href="#" id="change-origin">Change app origin…</a></p>
    <script type="module" src="popup.js"></script>
```

(Note the script tag becomes `type="module"`.) In `extension/popup.js`, add at the top:

```javascript
import { getAppOrigin, hasStoredAppOrigin } from "./lib/app-origin.js";
```

and inside the async IIFE, before the existing `try` block:

```javascript
  const origin = await getAppOrigin();
  const recordLink = document.getElementById("record-link");
  recordLink.href = `${origin}/record`;
  recordLink.textContent = new URL(origin).host;

  // First-run prompt: visible until the user has explicitly chosen an
  // origin (the default keeps working without choosing one).
  if (!(await hasStoredAppOrigin())) {
    document.getElementById("first-run").hidden = false;
  }
  for (const id of ["open-options", "change-origin"]) {
    document.getElementById(id).addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
```

- [ ] **Step 11: Comment + README updates**

- `extension/content-script-app.js` line 2: `* Content script that runs on the configured Loomola app origin (default origin via the static manifest entry; custom origins via chrome.scripting.registerContentScripts — see background.js syncAppContentScript).`
- `extension/README.md`: delete the perl one-liner block (lines 20–33) and replace with: load unpacked as-is; open the extension's **Options** (or the popup's "Change app origin…") and enter your instance URL (e.g. `https://loomola.example.com`, or `http://localhost:3000` for local dev — http is accepted for localhost only); note that no re-edit of `manifest.json` is needed and that Chrome match patterns ignore ports (the bridge will match your host on any port — harmless); note the default remains `loom.dissonance.cloud` when unset.

- [ ] **Step 12: Verify**

```bash
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('manifest ok')"
for f in extension/background.js extension/options.js extension/popup.js extension/lib/origin-utils.js extension/lib/app-origin.js; do
  node --input-type=module --check < "$f" && echo "ok: $f"; done
node --check extension/content-script-app.js && node --check extension/content-script-page.js
npx vitest run tests/unit/extension-origin-utils.test.ts && npm run typecheck && npm run test && npm run lint
```
Expected: all green. (`--input-type=module` matters: those five files use `import`/`export`; the two content scripts stay classic scripts.)

- [ ] **Step 13: Manual checklist for Ian (reload protocol — after this lands)**

1. `chrome://extensions` → Reload the unpacked extension (version shows **0.9.0**) and close tabs from the previous extension lifetime.
2. Default behavior unchanged: record on `loom.dissonance.cloud` → bubble appears, drags, follows tab switches; popup shows "Recording in progress".
3. Options → set `http://localhost:3000` → with `npm run dev` running, open `http://localhost:3000/record` and check the extension is detected (the record page's extension status pill, backed by `document.documentElement.dataset.loomCloneExtension === "1"`), and the popup link points at localhost.
4. Options → "Use default" → reload the prod tab → detection works there again.

- [ ] **Step 14: Commit**

```bash
git add extension/lib/origin-utils.js extension/lib/origin-utils.d.ts extension/lib/app-origin.js \
  extension/options.html extension/options.js extension/manifest.json extension/background.js \
  extension/popup.html extension/popup.js extension/content-script-app.js extension/README.md \
  tests/unit/extension-origin-utils.test.ts
git commit -m "Make the extension's app origin configurable via options page + dynamic registration

Default (no stored origin) is byte-identical behavior: the static
manifest content_script still covers loom.dissonance.cloud. Custom
origins register content-script-app.js dynamically — authorized by the
already-required <all_urls> host permission, so no optional_host_permissions
runtime prompt is needed (deviation from spec 5.1, documented in the plan).
Manifest 0.8.0 -> 0.9.0 per the reload protocol."
```

---

### Task 2: Notarized desktop release workflow (spec 5.2)

**Files:**
- Create: `.github/workflows/desktop-release.yml`
- Modify: `desktop/README.md` (download-first install section + one-time signing/notary secret setup for Ian)

Research facts this design rests on: release builds today are `desktop/scripts/build-dev-app.sh` with `LOOM_DESKTOP_BUILD_CONFIGURATION=release` (plain `swift build`, no xcodebuild), which assembles the full `.app` (Info.plist, NativeHost in `Contents/Resources`, extension copy, icon, DesktopConfig.plist) and signs ad-hoc/local — CI reuses it verbatim and **re-signs** on top. `Package.swift` is `swift-tools-version: 6.0`, so the runner must select Xcode 16.x (macos-14's default 15.x ships Swift 5.10). Public client config is baked at build time into `DesktopConfig.plist`; `DesktopAuthConfiguration.fromEnvironment` (desktop/Sources/LoomDesktopApp/Auth/AuthSessionStore.swift:35) falls back env → plist → throws for Supabase values, and Finder launches have no shell env — so the published DMG targets whatever instance this repo's Actions **variables** name (Ian's), and **self-hosters get their own DMG by forking and setting their own variables, or building from source**. Say this in the README; do not pretend the DMG is instance-agnostic. Entitlements: `desktop/App/LoomDesktop.entitlements` (camera + audio-input; no sandbox) — applied to the main app; the NativeHost binary is signed with hardened runtime and no entitlements.

- [ ] **Step 1: Create `.github/workflows/desktop-release.yml`**

```yaml
name: Desktop Release

on:
  push:
    tags: ["v*"]
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Build + package only: skip signing/notarization and skip the GitHub Release"
        type: boolean
        default: true

permissions:
  contents: write # create/append the GitHub Release

jobs:
  build-macos:
    runs-on: macos-14
    env:
      # Public client config baked into Contents/Resources/DesktopConfig.plist.
      # Repo VARIABLES (not secrets) — these are public client values (anon
      # key + URLs). Forks set their own to get a DMG for their instance.
      LOOM_API_BASE_URL: ${{ vars.LOOM_API_BASE_URL }}
      LOOM_SUPABASE_URL: ${{ vars.LOOM_SUPABASE_URL }}
      LOOM_SUPABASE_ANON_KEY: ${{ vars.LOOM_SUPABASE_ANON_KEY }}
    steps:
      - uses: actions/checkout@v4

      - name: Select an Xcode with a Swift 6 toolchain
        # Package.swift declares swift-tools-version 6.0; macos-14's default
        # Xcode is 15.x (Swift 5.10). Pick the newest installed Xcode 16.
        run: |
          XCODE="$(ls -d /Applications/Xcode_16*.app 2>/dev/null | sort -V | tail -1)"
          if [ -z "$XCODE" ]; then
            echo "::error::No Xcode 16 on this runner image — switch runs-on to macos-15."
            exit 1
          fi
          sudo xcode-select -s "$XCODE/Contents/Developer"
          swift --version

      - name: Resolve version
        id: version
        run: |
          if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
            echo "version=${GITHUB_REF#refs/tags/v}" >> "$GITHUB_OUTPUT"
          else
            echo "version=0.0.0-dev.${GITHUB_RUN_NUMBER}" >> "$GITHUB_OUTPUT"
          fi

      - name: Stamp bundle version from the tag
        run: |
          /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${{ steps.version.outputs.version }}" desktop/App/Info.plist
          /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${GITHUB_RUN_NUMBER}" desktop/App/Info.plist

      - name: Build release app bundle
        run: |
          if [ -z "$LOOM_SUPABASE_URL" ] || [ -z "$LOOM_SUPABASE_ANON_KEY" ]; then
            echo "::warning::LOOM_SUPABASE_URL / LOOM_SUPABASE_ANON_KEY repo variables are unset — the packaged app will refuse sign-in (no DesktopConfig.plist). See desktop/README.md → Release engineering."
          fi
          LOOM_DESKTOP_APP_PATH="$PWD/desktop/.build/Loomola.app" \
          LOOM_DESKTOP_BUILD_CONFIGURATION=release \
            desktop/scripts/build-dev-app.sh

      - name: Decide whether we can sign + notarize
        id: signing
        env:
          CERT: ${{ secrets.MACOS_CERT_P12_BASE64 }}
          NOTARY: ${{ secrets.NOTARY_KEY_BASE64 }}
          DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}
        run: |
          if [ -n "$CERT" ] && [ -n "$NOTARY" ] && [ "$DRY_RUN" != "true" ]; then
            echo "enabled=true" >> "$GITHUB_OUTPUT"
          else
            echo "enabled=false" >> "$GITHUB_OUTPUT"
            echo "::notice::Producing an UNSIGNED artifact (signing secrets absent, or dry run). The release path degrades gracefully — see desktop/README.md."
          fi

      - name: Import Developer ID certificate into a throwaway keychain
        if: steps.signing.outputs.enabled == 'true'
        env:
          MACOS_CERT_P12_BASE64: ${{ secrets.MACOS_CERT_P12_BASE64 }}
          MACOS_CERT_PASSWORD: ${{ secrets.MACOS_CERT_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          KEYCHAIN="$RUNNER_TEMP/release.keychain-db"
          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
          security set-keychain-settings -lut 21600 "$KEYCHAIN"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
          echo "$MACOS_CERT_P12_BASE64" | base64 --decode > "$RUNNER_TEMP/cert.p12"
          security import "$RUNNER_TEMP/cert.p12" -k "$KEYCHAIN" -P "$MACOS_CERT_PASSWORD" \
            -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
          security list-keychains -d user -s "$KEYCHAIN" login.keychain-db
          rm -f "$RUNNER_TEMP/cert.p12"

      - name: Sign with Developer ID (hardened runtime)
        if: steps.signing.outputs.enabled == 'true'
        run: |
          APP="desktop/.build/Loomola.app"
          IDENTITY="$(security find-identity -v -p codesigning | awk -F'"' '/Developer ID Application/ {print $2; exit}')"
          if [ -z "$IDENTITY" ]; then
            echo "::error::No 'Developer ID Application' identity found in the imported p12."
            exit 1
          fi
          # Inner Mach-O executables first, then the bundle (--deep is deprecated).
          codesign --force --options runtime --timestamp --sign "$IDENTITY" \
            "$APP/Contents/Resources/LoomDesktopNativeHost"
          codesign --force --options runtime --timestamp \
            --entitlements desktop/App/LoomDesktop.entitlements \
            --sign "$IDENTITY" "$APP"
          codesign --verify --strict --verbose=2 "$APP"

      - name: Create, sign, notarize, and staple the DMG
        if: steps.signing.outputs.enabled == 'true'
        env:
          NOTARY_KEY_ID: ${{ secrets.NOTARY_KEY_ID }}
          NOTARY_ISSUER_ID: ${{ secrets.NOTARY_ISSUER_ID }}
          NOTARY_KEY_BASE64: ${{ secrets.NOTARY_KEY_BASE64 }}
        run: |
          VERSION="${{ steps.version.outputs.version }}"
          DMG="output/desktop/Loomola-$VERSION.dmg"
          mkdir -p output/desktop
          STAGING="$(mktemp -d)"
          ditto "desktop/.build/Loomola.app" "$STAGING/Loomola.app"
          ln -s /Applications "$STAGING/Applications"
          hdiutil create -volname "Loomola" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
          IDENTITY="$(security find-identity -v -p codesigning | awk -F'"' '/Developer ID Application/ {print $2; exit}')"
          codesign --force --timestamp --sign "$IDENTITY" "$DMG"
          echo "$NOTARY_KEY_BASE64" | base64 --decode > "$RUNNER_TEMP/notary.p8"
          xcrun notarytool submit "$DMG" \
            --key "$RUNNER_TEMP/notary.p8" \
            --key-id "$NOTARY_KEY_ID" \
            --issuer "$NOTARY_ISSUER_ID" \
            --wait
          rm -f "$RUNNER_TEMP/notary.p8"
          xcrun stapler staple "$DMG"
          spctl -a -t open --context context:primary-signature -v "$DMG"

      - name: Package unsigned fallback zip
        if: steps.signing.outputs.enabled != 'true'
        run: |
          VERSION="${{ steps.version.outputs.version }}"
          mkdir -p output/desktop
          # build-dev-app.sh already ad-hoc signed the bundle on the runner.
          ditto -c -k --keepParent "desktop/.build/Loomola.app" \
            "output/desktop/Loomola-$VERSION-unsigned.zip"
          echo "::notice::Unsigned artifact: users must right-click > Open (Gatekeeper) — or wait for a signed release."

      - name: Upload workflow artifact (dry runs and tags alike)
        uses: actions/upload-artifact@v4
        with:
          name: loomola-desktop-${{ steps.version.outputs.version }}
          path: output/desktop/*
          if-no-files-found: error

      - name: Attach to the GitHub Release
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: output/desktop/*
          generate_release_notes: true

      - name: Clean up keychain
        if: always() && steps.signing.outputs.enabled == 'true'
        run: security delete-keychain "$RUNNER_TEMP/release.keychain-db" || true
```

- [ ] **Step 2: Update `desktop/README.md`**

Rewrite the "Signing and Notarization" section (lines ~256–270) and add an install-first preamble near the top:

- **Primary install path:** download `Loomola-<version>.dmg` from the latest GitHub Release (signed + notarized once secrets are configured; until then releases carry `Loomola-<version>-unsigned.zip` — right-click → Open to bypass Gatekeeper). **Honest constraint, stated plainly:** the published DMG bakes the Supabase URL / anon key / API base URL from this repo's Actions variables, i.e. it talks to `loom.dissonance.cloud`. The app has no in-app server picker yet; self-hosters either build from source with their own `.env.local` (existing instructions) or fork the repo, set the three repo variables, and run the Desktop Release workflow to mint a DMG for their instance.
- **One-time setup for Ian (exact commands):**

````markdown
### One-time release credentials (repo admin)

Requires an Apple Developer Program membership (~$99/yr).

1. **Developer ID Application certificate.** Xcode → Settings → Accounts →
   (your team) → Manage Certificates… → "+" → Developer ID Application.
   Then in Keychain Access → login → My Certificates, right-click
   "Developer ID Application: <name> (<TEAMID>)" → Export… → `developer-id.p12`
   with a strong export password.

2. **App Store Connect API key** (preferred over Apple-ID/app-specific
   password for notarytool). appstoreconnect.apple.com → Users and Access →
   Integrations → App Store Connect API → Team Keys → Generate API Key,
   role **Developer**. Note the Key ID and Issuer ID; download
   `AuthKey_<KEYID>.p8` (downloadable exactly once).

3. **Set the secrets and variables:**

   ```bash
   base64 -i developer-id.p12 | gh secret set MACOS_CERT_P12_BASE64 -R Deducer/loomola
   gh secret set MACOS_CERT_PASSWORD -R Deducer/loomola        # the p12 export password
   gh secret set KEYCHAIN_PASSWORD -R Deducer/loomola --body "$(openssl rand -hex 24)"
   gh secret set NOTARY_KEY_ID -R Deducer/loomola              # e.g. ABC123DEF4
   gh secret set NOTARY_ISSUER_ID -R Deducer/loomola           # UUID from the Integrations page
   base64 -i AuthKey_<KEYID>.p8 | gh secret set NOTARY_KEY_BASE64 -R Deducer/loomola

   gh variable set LOOM_API_BASE_URL -R Deducer/loomola --body "https://loom.dissonance.cloud"
   gh variable set LOOM_SUPABASE_URL -R Deducer/loomola --body "https://<project>.supabase.co"
   gh variable set LOOM_SUPABASE_ANON_KEY -R Deducer/loomola --body "<anon key>"
   ```

   Then delete the local `developer-id.p12` and `AuthKey_*.p8` copies.

Until these exist, tag builds still succeed and attach
`Loomola-<version>-unsigned.zip` to the release.
````

- [ ] **Step 3: Verify**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/desktop-release.yml','utf8')); console.log('yaml ok')"
```
Expected: `yaml ok`. Review checklist (no `act` available): every `${{ secrets.* }}` reference appears only in `env:`/`with:` blocks (never interpolated into `run:` shell text); the unsigned path touches no secrets; `permissions.contents: write` present; the Release step is tag-gated. After this lands on `main`, the controller/Ian runs **Actions → Desktop Release → Run workflow (dry_run: true)** — expected: green build on the runner, an uploaded `Loomola-0.0.0-dev.N-unsigned.zip` artifact, no Release created. That dispatch run is the workflow's real gate; note it in the PR/commit description.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/desktop-release.yml desktop/README.md
git commit -m "Add notarized desktop release workflow with unsigned fallback

v* tags build the release .app via the existing build script, re-sign
with Developer ID + hardened runtime, notarize the DMG via notarytool
(App Store Connect API key), staple, and attach to the GitHub Release.
Without signing secrets (or via workflow_dispatch dry_run) it degrades
to an ad-hoc-signed Loomola-<version>-unsigned.zip. Client config bakes
from repo variables so forks can mint DMGs for their own instance."
```

---

### Task 3: Prebuilt web image on GHCR, honestly positioned (spec 5.3)

**Files:**
- Create: `.github/workflows/docker-publish.yml`
- Modify: `docker-compose.yml` (comment block only — `build: .` stays the default)
- Modify: `README.md` (a short "Prebuilt image (GHCR)" subsection in the self-hosting/compose area)

**The constraint, verified in code (do not soften it in docs):** `src/lib/supabase/client.ts` is the browser Supabase client and reads `process.env.NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`; Next.js inlines all `NEXT_PUBLIC_*` values into the build output at `next build` time (the Dockerfile takes them as `ARG`s in the build stage for exactly this reason), and there is **no** runtime bootstrap endpoint that feeds the browser its config — a grep for any `/api`-served Supabase URL comes up empty. Therefore an image built with placeholders (the same `https://placeholder.supabase.co` values `ci.yml` already builds green with) boots and serves pages but **browser auth cannot work**. Decision: compose keeps `build: .` (it already does); the GHCR image exists for (a) registry build-cache that speeds everyone's `docker compose build`, (b) forks that bake their own values via `workflow_dispatch` inputs, (c) CI provenance per tag. The image's OCI description label says this so it's visible on the GHCR page itself.

- [ ] **Step 1: Create `.github/workflows/docker-publish.yml`**

```yaml
name: Publish Docker image

# NOTE on the published image: Next.js inlines NEXT_PUBLIC_* at build time
# (see Dockerfile build ARGs; src/lib/supabase/client.ts consumes them in the
# browser bundle). The default image is built with placeholder values, so
# BROWSER AUTH DOES NOT WORK with it out of the box. It exists as a build-
# cache source and a base for forks that bake their own values via
# workflow_dispatch. `docker compose up` (build: .) remains the supported
# self-host path — see README "Prebuilt image (GHCR)".

on:
  push:
    branches: [main]
    tags: ["v*"]
  workflow_dispatch:
    inputs:
      next_public_supabase_url:
        description: "Bake a real NEXT_PUBLIC_SUPABASE_URL (forks: your own instance)"
        type: string
        default: ""
      next_public_supabase_anon_key:
        description: "Bake a real NEXT_PUBLIC_SUPABASE_ANON_KEY"
        type: string
        default: ""
      next_public_app_url:
        description: "Bake a real NEXT_PUBLIC_APP_URL"
        type: string
        default: ""

permissions:
  contents: write # GitHub Release on tags
  packages: write # push to GHCR

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          # Lowercased automatically -> ghcr.io/deducer/loomola on this repo;
          # forks publish under their own namespace with zero edits.
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=ref,event=branch
            type=sha
          labels: |
            org.opencontainers.image.description=Loomola web app. NEXT_PUBLIC_* values are baked at build time with placeholders — browser auth requires building your own image (docker compose up does this). See the repo README, "Prebuilt image (GHCR)".

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            NEXT_PUBLIC_SUPABASE_URL=${{ inputs.next_public_supabase_url || 'https://placeholder.supabase.co' }}
            NEXT_PUBLIC_SUPABASE_ANON_KEY=${{ inputs.next_public_supabase_anon_key || 'placeholder-anon-key' }}
            NEXT_PUBLIC_APP_URL=${{ inputs.next_public_app_url || 'http://localhost:3000' }}
            NEXT_PUBLIC_BUILD_COMMIT=${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Create or update the GitHub Release for this tag
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          body: |
            See `CHANGELOG.md` for the curated changes in this release.

            Container image: `ghcr.io/deducer/loomola:${{ github.ref_name }}`
            (placeholder `NEXT_PUBLIC_*` — self-hosters: use `docker compose up`,
            which builds with your values; see README.)
```

(The placeholder build-arg values are exactly what `.github/workflows/ci.yml` already builds green with, so this cannot rot independently of CI.)

- [ ] **Step 2: Document in `docker-compose.yml`**

Add to the existing header comment block (after line 9), changing no service definitions:

```yaml
# A prebuilt image exists at ghcr.io/deducer/loomola, BUT Next.js bakes
# NEXT_PUBLIC_* (Supabase URL/anon key) into the bundle at build time, so
# the generic image cannot serve YOUR browser auth. `build: .` below is
# the supported path — it bakes your values from .env.compose. The GHCR
# image is for CI cache and for forks that bake their own values via the
# "Publish Docker image" workflow_dispatch inputs.
```

- [ ] **Step 3: README subsection**

In `README.md`, inside the self-hosting/compose section, add:

```markdown
### Prebuilt image (GHCR)

`ghcr.io/deducer/loomola` is published on every push to `main` and on
release tags. Caveat that matters: Next.js inlines `NEXT_PUBLIC_*`
(your Supabase URL and anon key) into the JavaScript bundle **at build
time**, and the public image is built with placeholders — so sign-in in
the browser cannot work with it as-is. There is no runtime override.

- **Self-hosting?** Use `docker compose up` — it builds the image with
  your values from `.env.compose`. This is the supported path.
- **Want your own prebuilt image?** Fork the repo and run the
  "Publish Docker image" workflow with your `NEXT_PUBLIC_*` values as
  inputs; it publishes to your fork's GHCR namespace.
- The public image is still useful as a build-cache source and for
  poking at the container layout.
```

- [ ] **Step 4: Verify**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/docker-publish.yml','utf8')); console.log('yaml ok')"
docker compose config -q && echo "compose ok"
```
Expected: both ok (compose check needs `.env.compose` present locally per the file header; if absent, `docker compose --env-file .env.compose.example config -q`... the example may have empty required vars — acceptable to skip the compose check then, since the change is comment-only; say so in the task notes). After landing on `main`, the first push runs the workflow — expected: `ghcr.io/deducer/loomola:main` + `:sha-<short>` appear under the repo's Packages with the warning label visible.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docker-publish.yml docker-compose.yml README.md
git commit -m "Publish web image to GHCR; document the NEXT_PUBLIC build-time constraint honestly

The generic image bakes placeholder NEXT_PUBLIC_* values (browser auth
cannot work with it — Next inlines them at build time and no runtime
bootstrap exists), so compose keeps build:. as the supported path and
the image is positioned for build-cache + fork-baked personal images."
```

---

### Task 4: Release engineering — version sync, CHANGELOG convention, release procedure (spec 5.4)

**Files:**
- Modify: `package.json` + `package-lock.json` (version `0.0.1` → `1.0.0`)
- Modify: `desktop/App/Info.plist` (`CFBundleShortVersionString` `0.1.0` → `1.0.0`; CI stamps from the tag anyway — this keeps local builds honest)
- Modify: `CHANGELOG.md` (add `## Unreleased`, document the per-version convention)
- Create: `docs/releasing.md`

- [ ] **Step 1: Version sync**

In `package.json` line 3: `"version": "0.0.1"` → `"version": "1.0.0"`, then:

```bash
npm install --package-lock-only
```
Expected `git diff package-lock.json`: only the two `"version": "0.0.1"` → `"1.0.0"` lines (root + `packages[""]`). If anything else changes, revert the lockfile and investigate before proceeding.

In `desktop/App/Info.plist`: `CFBundleShortVersionString` `0.1.0` → `1.0.0`.

- [ ] **Step 2: CHANGELOG convention**

At the top of `CHANGELOG.md`, replace the intro paragraph (lines 3–5) with:

```markdown
Loomola used date-based release notes while the product was pre-1.0; those
entries are preserved below. From v1.0.0 onward, each release gets a
version section (`## v1.1.0 — 2026-07-01`) accumulated under `## Unreleased`
between tags. GitHub Releases are generated per tag by CI and point here
for the curated notes.

## Unreleased

- Distribution: configurable Chrome-extension origin (options page),
  notarized desktop release pipeline, GHCR image publishing, and release
  engineering. (Phase 5 of the open-source readiness effort.)
```

- [ ] **Step 3: Create `docs/releasing.md`**

```markdown
# Releasing Loomola

One release per `v*` tag. Two workflows fire on the tag and assemble a
single GitHub Release:

- `docker-publish.yml` — pushes `ghcr.io/deducer/loomola:<version>` and
  creates the Release with generated notes + a CHANGELOG pointer.
- `desktop-release.yml` — attaches `Loomola-<version>.dmg` (signed +
  notarized when secrets are present; `-unsigned.zip` otherwise).

Both use `softprops/action-gh-release`, which updates an existing release
for the tag and appends assets — so creation order doesn't matter. If the
two jobs race on the *initial* creation and one fails with an API
conflict, just re-run that job; it will append to the now-existing release.

## Procedure

1. CI green on `main`; working tree clean.
2. Move the `## Unreleased` items in `CHANGELOG.md` into a new
   `## v<X.Y.Z> — <date>` section; commit.
3. Confirm version sync: `package.json` `version` and
   `desktop/App/Info.plist` `CFBundleShortVersionString` match the tag
   you are about to create (the desktop workflow also stamps the bundle
   from the tag at build time, so the plist is belt-and-braces).
4. Tag and push (the only step that publishes anything):

   ```bash
   git tag v<X.Y.Z>
   git push origin v<X.Y.Z>
   ```

5. Watch both workflow runs; verify the Release has the DMG (or
   `-unsigned.zip`) attached and the GHCR package shows the version tag.

## v1.0.0 specifically

**Deferred:** `v1.0.0` is tagged at the END of Phase 6 (hygiene & docs),
after the full compose-from-scratch run and the recorded unassisted-setup
acceptance test — not when this file lands. Everything above is already
wired so that tag is a one-command act.
```

- [ ] **Step 4: Verify**

```bash
node -e "const p=require('./package.json'); if (p.version!=='1.0.0') throw new Error(p.version); console.log('version ok')"
node -e "const l=require('./package-lock.json'); if (l.version!=='1.0.0'||l.packages[''].version!=='1.0.0') throw new Error('lock'); console.log('lock ok')"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' desktop/App/Info.plist   # -> 1.0.0
npm run test && npm run typecheck && npm run lint
```
Expected: all green; no test reads the package version, so the suite is unaffected.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json desktop/App/Info.plist CHANGELOG.md docs/releasing.md
git commit -m "Release engineering: sync versions to 1.0.0, per-version CHANGELOG convention, releasing doc

The v1.0.0 tag itself is deferred to the end of Phase 6 per the spec
sequencing; this commit makes that tag a one-command act."
```

---

## Spec-coverage self-check

| Spec item | Where |
|---|---|
| 5.1 Options page + first-run popup prompt, origin in `chrome.storage.sync` | Task 1 (options.html/options.js; popup first-run section) |
| 5.1 Runtime grants via `optional_host_permissions` | **Deliberate deviation** — manifest already requires `<all_urls>` for the bubble injector, so no runtime permission flow exists or is needed; dynamic `registerContentScripts` is authorized by the existing grant (documented in Task 1 / Architecture) |
| 5.1 `background.js` tab queries + content-script injection driven by stored origin | Task 1 Step 8 (`appUrlPattern()`, `syncAppContentScript()`); port-stripping match-pattern subtlety handled in `origin-utils.js` |
| 5.1 Default remains Ian's instance; manifest version bump per reload protocol | Task 1 (static manifest entry untouched for the default; `0.8.0 → 0.9.0`; Ian's manual checklist) |
| 5.2 Tag-triggered macOS build, Developer ID sign, notarize, staple, DMG, Release | Task 2 (`desktop-release.yml`) |
| 5.2 Degrade to clearly-named unsigned artifact until secrets land | Task 2 (`-unsigned.zip` path, secret-presence gate) |
| 5.2 Guided one-time secrets for Ian (p12 + notary API key + `gh secret set`) | Task 2 Step 2 (desktop/README.md) |
| 5.2 desktop/README: download-DMG primary, source fallback (+ honest baked-config note) | Task 2 Step 2 |
| 5.3 GHCR publish on tags (and main), NEXT_PUBLIC constraint decided + documented | Task 3 — placeholder-built image cannot do browser auth (verified in `src/lib/supabase/client.ts` + Dockerfile ARGs); compose stays `build: .`; fork-bake path via dispatch inputs |
| 5.4 package.json version sync; CHANGELOG per-version sections; Release notes from CHANGELOG | Task 4; Release creation wired in Tasks 2+3 (softprops append handles the two-workflow race) |
| 5.4 Tag v1.0.0 when the effort completes | Explicitly deferred to end of Phase 6 — `docs/releasing.md` says so |

---

### Critical Files for Implementation

- /Users/iancross/Development/03Utilities/Loom_Clone/extension/background.js
- /Users/iancross/Development/03Utilities/Loom_Clone/extension/manifest.json
- /Users/iancross/Development/03Utilities/Loom_Clone/desktop/scripts/build-dev-app.sh
- /Users/iancross/Development/03Utilities/Loom_Clone/Dockerfile
- /Users/iancross/Development/03Utilities/Loom_Clone/src/lib/supabase/client.ts