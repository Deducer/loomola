#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
APP_PATH="${LOOM_DESKTOP_APP_PATH:-"$ROOT_DIR/.build/LoomDesktop.app"}"
CONTENTS_DIR="$APP_PATH/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
EXECUTABLE_PATH="$MACOS_DIR/LoomDesktop"

LOGO_SOURCE="$REPO_ROOT/public/branding/loomola-logo-mark.png"

swift build --package-path "$ROOT_DIR" --product LoomDesktop
BIN_DIR="$(swift build --package-path "$ROOT_DIR" --show-bin-path)"

rm -rf "$APP_PATH"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$BIN_DIR/LoomDesktop" "$EXECUTABLE_PATH"
cp "$ROOT_DIR/App/Info.plist" "$CONTENTS_DIR/Info.plist"
printf 'APPL????' > "$CONTENTS_DIR/PkgInfo"
chmod +x "$EXECUTABLE_PATH"

# Bundle the brand logo as a PNG resource for in-app use (menubar item,
# header card). Loaded via NSImage(named: "loomola-logo-mark").
if [[ -f "$LOGO_SOURCE" ]]; then
  cp "$LOGO_SOURCE" "$RESOURCES_DIR/loomola-logo-mark.png"
else
  echo "warning: $LOGO_SOURCE not found; in-app logo will be missing"
fi

# Generate AppIcon.icns from the brand logo so the .app gets the right
# Dock / Cmd-Tab / Finder / About icon. Skipped silently if iconutil isn't
# available (non-macOS host) — the bundle still builds, just without an
# icon override.
if [[ -f "$LOGO_SOURCE" ]] && command -v iconutil >/dev/null 2>&1; then
  ICONSET_DIR="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET_DIR"
  for SPEC in \
    "16 icon_16x16.png" \
    "32 icon_16x16@2x.png" \
    "32 icon_32x32.png" \
    "64 icon_32x32@2x.png" \
    "128 icon_128x128.png" \
    "256 icon_128x128@2x.png" \
    "256 icon_256x256.png" \
    "512 icon_256x256@2x.png" \
    "512 icon_512x512.png" \
    "1024 icon_512x512@2x.png"
  do
    SIZE="${SPEC%% *}"
    NAME="${SPEC#* }"
    sips -z "$SIZE" "$SIZE" "$LOGO_SOURCE" --out "$ICONSET_DIR/$NAME" >/dev/null
  done
  iconutil -c icns -o "$RESOURCES_DIR/AppIcon.icns" "$ICONSET_DIR"
  rm -rf "$ICONSET_DIR"
fi

if command -v codesign >/dev/null 2>&1; then
  codesign \
    --force \
    --sign - \
    --entitlements "$ROOT_DIR/App/LoomDesktop.entitlements" \
    "$APP_PATH" >/dev/null
fi

echo "Built dev app bundle: $APP_PATH"
