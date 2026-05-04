#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${LOOM_DESKTOP_APP_PATH:-"$ROOT_DIR/.build/LoomDesktop.app"}"
CONTENTS_DIR="$APP_PATH/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
EXECUTABLE_PATH="$MACOS_DIR/LoomDesktop"

swift build --package-path "$ROOT_DIR" --product LoomDesktop
BIN_DIR="$(swift build --package-path "$ROOT_DIR" --show-bin-path)"

rm -rf "$APP_PATH"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$BIN_DIR/LoomDesktop" "$EXECUTABLE_PATH"
cp "$ROOT_DIR/App/Info.plist" "$CONTENTS_DIR/Info.plist"
printf 'APPL????' > "$CONTENTS_DIR/PkgInfo"
chmod +x "$EXECUTABLE_PATH"

if command -v codesign >/dev/null 2>&1; then
  codesign \
    --force \
    --sign - \
    --entitlements "$ROOT_DIR/App/LoomDesktop.entitlements" \
    "$APP_PATH" >/dev/null
fi

echo "Built dev app bundle: $APP_PATH"
