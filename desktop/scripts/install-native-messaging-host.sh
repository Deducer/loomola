#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <chrome-extension-id>" >&2
  exit 64
fi

EXTENSION_ID="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_NAME="com.dissonance.loom_desktop"
HOST_MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_MANIFEST_PATH="$HOST_MANIFEST_DIR/$HOST_NAME.json"

swift build --package-path "$ROOT_DIR" --product LoomDesktopNativeHost

HOST_PATH="$ROOT_DIR/.build/debug/LoomDesktopNativeHost"
mkdir -p "$HOST_MANIFEST_DIR"

cat > "$HOST_MANIFEST_PATH" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Loom Desktop Granola meeting signal bridge",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
JSON

echo "Installed Chrome native messaging host:"
echo "$HOST_MANIFEST_PATH"
