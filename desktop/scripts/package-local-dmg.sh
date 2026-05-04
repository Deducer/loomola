#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
APP_NAME="${LOOM_DESKTOP_APP_NAME:-Loomola}"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT_DIR/App/Info.plist")"
OUTPUT_DIR="${LOOM_DESKTOP_OUTPUT_DIR:-"$REPO_ROOT/output/desktop"}"
BUILD_APP_PATH="$ROOT_DIR/.build/$APP_NAME.app"
DMG_PATH="$OUTPUT_DIR/$APP_NAME-$VERSION-local.dmg"
STAGING_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

read_env_value() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "${line}" ]]; then
    return 1
  fi

  local value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value}"
}

set_env_from_file() {
  local target="$1"
  local file="$2"
  shift 2

  if [[ -n "${!target:-}" || ! -f "${file}" ]]; then
    return
  fi

  local key
  for key in "$@"; do
    local value
    value="$(read_env_value "${file}" "${key}" || true)"
    if [[ -n "${value}" ]]; then
      export "${target}=${value}"
      return
    fi
  done
}

cd "$ROOT_DIR"

set_env_from_file LOOM_SUPABASE_URL .env.local LOOM_SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_URL
set_env_from_file LOOM_SUPABASE_ANON_KEY .env.local LOOM_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_ANON_KEY
set_env_from_file LOOM_API_BASE_URL .env.local LOOM_DESKTOP_API_BASE_URL LOOM_API_BASE_URL
set_env_from_file LOOM_SUPABASE_URL "$REPO_ROOT/.env.local" LOOM_SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_URL
set_env_from_file LOOM_SUPABASE_ANON_KEY "$REPO_ROOT/.env.local" LOOM_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_ANON_KEY
set_env_from_file LOOM_API_BASE_URL "$REPO_ROOT/.env.local" LOOM_DESKTOP_API_BASE_URL LOOM_API_BASE_URL

export LOOM_API_BASE_URL="${LOOM_API_BASE_URL:-https://loom.dissonance.cloud}"

if [[ -z "${LOOM_SUPABASE_URL:-}" || -z "${LOOM_SUPABASE_ANON_KEY:-}" ]]; then
  echo "Missing LOOM_SUPABASE_URL or LOOM_SUPABASE_ANON_KEY."
  echo "Create desktop/.env.local from desktop/.env.example, or keep the public Supabase values in the repo-root .env.local."
  exit 1
fi

echo "Building $APP_NAME app bundle for local DMG..."
LOOM_DESKTOP_APP_PATH="$BUILD_APP_PATH" \
LOOM_DESKTOP_BUILD_CONFIGURATION="${LOOM_DESKTOP_BUILD_CONFIGURATION:-release}" \
  "$ROOT_DIR/scripts/build-dev-app.sh"

mkdir -p "$OUTPUT_DIR"
ditto "$BUILD_APP_PATH" "$STAGING_DIR/$APP_NAME.app"
ln -s /Applications "$STAGING_DIR/Applications"

rm -f "$DMG_PATH"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$DMG_PATH" >/dev/null || true
fi

echo "Built local DMG: $DMG_PATH"
