#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
APP_PATH="${LOOM_DESKTOP_APP_PATH:-"$ROOT_DIR/.build/LoomDesktop.app"}"
CONTENTS_DIR="$APP_PATH/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
EXECUTABLE_PATH="$MACOS_DIR/LoomDesktop"
NATIVE_HOST_PATH="$RESOURCES_DIR/LoomDesktopNativeHost"
BUILD_CONFIGURATION="${LOOM_DESKTOP_BUILD_CONFIGURATION:-debug}"

LOGO_SOURCE="$REPO_ROOT/public/branding/loomola-logo-mark.png"
EXTENSION_SOURCE="$REPO_ROOT/extension"

swift build --package-path "$ROOT_DIR" --configuration "$BUILD_CONFIGURATION" --product LoomDesktop
swift build --package-path "$ROOT_DIR" --configuration "$BUILD_CONFIGURATION" --product LoomDesktopNativeHost
BIN_DIR="$(swift build --package-path "$ROOT_DIR" --configuration "$BUILD_CONFIGURATION" --show-bin-path)"

rm -rf "$APP_PATH"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$BIN_DIR/LoomDesktop" "$EXECUTABLE_PATH"
cp "$BIN_DIR/LoomDesktopNativeHost" "$NATIVE_HOST_PATH"
cp "$ROOT_DIR/scripts/install-native-messaging-host.sh" "$RESOURCES_DIR/install-native-messaging-host.sh"
cp "$ROOT_DIR/App/Info.plist" "$CONTENTS_DIR/Info.plist"
printf 'APPL????' > "$CONTENTS_DIR/PkgInfo"
chmod +x "$EXECUTABLE_PATH"
chmod +x "$NATIVE_HOST_PATH" "$RESOURCES_DIR/install-native-messaging-host.sh"

if [[ -d "$EXTENSION_SOURCE" ]]; then
  ditto "$EXTENSION_SOURCE" "$RESOURCES_DIR/extension"
fi

xml_escape() {
  printf '%s' "$1" \
    | sed \
      -e 's/&/\&amp;/g' \
      -e 's/</\&lt;/g' \
      -e 's/>/\&gt;/g' \
      -e 's/"/\&quot;/g' \
      -e "s/'/\&apos;/g"
}

LOOM_API_BASE_URL="${LOOM_API_BASE_URL:-https://loom.dissonance.cloud}"

# Build stamp so the running app can prove which commit it came
# from (visible in Settings → Account). Falls back to "unknown" off
# the git tree.
BUILD_COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [[ "$BUILD_COMMIT" != "unknown" ]] && ! git -C "$REPO_ROOT" diff --quiet --ignore-submodules HEAD -- . ':(exclude).claude/settings.local.json' 2>/dev/null; then
  BUILD_COMMIT="$BUILD_COMMIT-dirty"
fi
BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ -n "${LOOM_SUPABASE_URL:-}" && -n "${LOOM_SUPABASE_ANON_KEY:-}" ]]; then
  cat > "$RESOURCES_DIR/DesktopConfig.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>LOOM_API_BASE_URL</key>
	<string>$(xml_escape "$LOOM_API_BASE_URL")</string>
	<key>LOOM_SUPABASE_URL</key>
	<string>$(xml_escape "$LOOM_SUPABASE_URL")</string>
	<key>LOOM_SUPABASE_ANON_KEY</key>
	<string>$(xml_escape "$LOOM_SUPABASE_ANON_KEY")</string>
	<key>LOOM_BUILD_COMMIT</key>
	<string>$(xml_escape "$BUILD_COMMIT")</string>
	<key>LOOM_BUILD_DATE</key>
	<string>$(xml_escape "$BUILD_DATE")</string>
</dict>
</plist>
PLIST
else
  echo "warning: LOOM_SUPABASE_URL or LOOM_SUPABASE_ANON_KEY missing; bundled app will require environment config"
fi

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
  # Prefer the stable self-signed identity if it exists (set up via
  # `desktop/scripts/setup-signing-identity.sh`). Without it, fall
  # back to ad-hoc — but that means TCC permissions reset on every
  # rebuild, so warn the user.
  STABLE_CERT_CN="Loomola Local Signing"
  CODESIGN_IDENTITY="-"
  # Drop -v: self-signed certs show as CSSMERR_TP_NOT_TRUSTED but
  # codesign + TCC work fine with them. We just need the signature
  # requirement to stay stable across rebuilds.
  if security find-identity -p codesigning 2>/dev/null \
      | grep -q "$STABLE_CERT_CN"; then
    CODESIGN_IDENTITY="$STABLE_CERT_CN"
  else
    cat <<'WARN' >&2
warning: ad-hoc signing — TCC permissions (Camera, Mic, Screen
  Recording, Accessibility) will RESET on every rebuild. Run
  desktop/scripts/setup-signing-identity.sh once to create a
  stable self-signed identity. Permissions then persist.
WARN
  fi

  codesign \
    --force \
    --sign "$CODESIGN_IDENTITY" \
    --entitlements "$ROOT_DIR/App/LoomDesktop.entitlements" \
    "$APP_PATH" >/dev/null
fi

echo "Built app bundle: $APP_PATH"
echo "  Commit: $BUILD_COMMIT"
echo "  Date:   $BUILD_DATE"
