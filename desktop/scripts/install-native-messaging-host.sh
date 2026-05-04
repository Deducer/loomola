#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/extension" ]]; then
  EXTENSION_DIR="$SCRIPT_DIR/extension"
else
  EXTENSION_DIR="$REPO_ROOT/extension"
fi
HOST_NAME="com.dissonance.loom_desktop"
EXTENSION_IDS=("$@")
STABLE_EXTENSION_ID="fhlommkndlhemikefocglkknpofgkfkj"
BUNDLED_HOST_PATH="$SCRIPT_DIR/LoomDesktopNativeHost"

if [[ ${#EXTENSION_IDS[@]} -eq 0 ]]; then
  if command -v node >/dev/null 2>&1; then
    while IFS= read -r id; do
      [[ -n "$id" ]] && EXTENSION_IDS+=("$id")
    done < <(node - "$EXTENSION_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const extensionDir = path.resolve(process.argv[2]);
const home = process.env.HOME;
const browserRoots = [
  path.join(home, "Library/Application Support/Google/Chrome"),
  path.join(home, "Library/Application Support/BraveSoftware/Brave-Browser"),
  path.join(home, "Library/Application Support/Microsoft Edge"),
  path.join(home, "Library/Application Support/Arc/User Data"),
  path.join(home, "Library/Application Support/Chromium"),
  path.join(home, "Library/Application Support/Vivaldi"),
  path.join(home, "Library/Application Support/com.operasoftware.Opera"),
  path.join(home, "Library/Application Support/OpenAI/ChatGPT Atlas"),
];
const ids = new Set();

function extensionIdFromKey(key) {
  const hash = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest();
  const alphabet = "abcdefghijklmnop";
  let id = "";
  for (const byte of hash.subarray(0, 16)) {
    id += alphabet[byte >> 4] + alphabet[byte & 15];
  }
  return id;
}

try {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
  if (manifest.key) ids.add(extensionIdFromKey(manifest.key));
} catch {
  // Profile detection below is still useful if the manifest is unreadable.
}

for (const root of browserRoots) {
  if (!fs.existsSync(root)) continue;
  const profiles = [root];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) profiles.push(path.join(root, entry.name));
  }
  for (const profile of profiles) {
    const preferencesPath = path.join(profile, "Preferences");
    if (!fs.existsSync(preferencesPath)) continue;
    try {
      const preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
      const settings = preferences.extensions?.settings ?? {};
      for (const [id, extension] of Object.entries(settings)) {
        if (!extension?.path) continue;
        const extensionPath = path.isAbsolute(extension.path)
          ? path.resolve(extension.path)
          : path.resolve(profile, extension.path);
        if (extensionPath === extensionDir) ids.add(id);
      }
    } catch {
      // Ignore locked or partially-written Preferences files.
    }
  }
}

for (const id of ids) console.log(id);
NODE
    )
  fi
fi

if [[ ${#EXTENSION_IDS[@]} -eq 0 ]]; then
  EXTENSION_IDS=("$STABLE_EXTENSION_ID")
fi

if [[ ${#EXTENSION_IDS[@]} -eq 0 ]]; then
  echo "Could not auto-detect the extension ID." >&2
  echo "Load extension/ at chrome://extensions, copy its ID, then run:" >&2
  echo "$0 <chrome-extension-id>" >&2
  exit 64
fi

for id in "${EXTENSION_IDS[@]}"; do
  if [[ ! "$id" =~ ^[a-p]{32}$ ]]; then
    echo "Invalid Chrome extension ID: $id" >&2
    exit 64
  fi
done

if [[ -x "$BUNDLED_HOST_PATH" ]]; then
  HOST_PATH="$BUNDLED_HOST_PATH"
else
  swift build --package-path "$ROOT_DIR" --product LoomDesktopNativeHost
  HOST_PATH="$ROOT_DIR/.build/debug/LoomDesktopNativeHost"
fi

json_escape() {
  printf '%s' "$1" \
    | sed \
      -e 's/\\/\\\\/g' \
      -e 's/"/\\"/g'
}

HOST_DIRS=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
  "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  "$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts"
  "$HOME/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts"
  "$HOME/Library/Application Support/OpenAI/ChatGPT Atlas/NativeMessagingHosts"
)

INSTALLED=0
for host_dir in "${HOST_DIRS[@]}"; do
  browser_root="${host_dir%/NativeMessagingHosts}"
  if [[ ! -d "$browser_root" && ! -d "$host_dir" ]]; then
    continue
  fi

  mkdir -p "$host_dir"
  host_manifest_path="$host_dir/$HOST_NAME.json"
  allowed_origins=""
  for id in "${EXTENSION_IDS[@]}"; do
    origin="chrome-extension://$id/"
    if [[ -n "$allowed_origins" ]]; then
      allowed_origins="$allowed_origins,"
    fi
    allowed_origins="$allowed_origins
    \"$(json_escape "$origin")\""
  done

  cat > "$host_manifest_path" <<JSON
{
  "name": "$(json_escape "$HOST_NAME")",
  "description": "Loomola meeting signal bridge",
  "path": "$(json_escape "$HOST_PATH")",
  "type": "stdio",
  "allowed_origins": [$allowed_origins
  ]
}
JSON
  echo "Installed native messaging host: $host_manifest_path"
  INSTALLED=$((INSTALLED + 1))
done

if [[ "$INSTALLED" -eq 0 ]]; then
  echo "No Chromium-family browser profile directories were found." >&2
  exit 1
fi

echo "Allowed extension ID(s): ${EXTENSION_IDS[*]}"
