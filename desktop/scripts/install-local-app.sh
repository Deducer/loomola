#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
APP_NAME="${LOOM_DESKTOP_APP_NAME:-Loomola}"
INSTALL_DIR="${LOOM_DESKTOP_INSTALL_DIR:-/Applications}"
BUILD_APP_PATH="$ROOT_DIR/.build/$APP_NAME.app"
INSTALLED_APP_PATH="$INSTALL_DIR/$APP_NAME.app"

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

if [[ ! -d "$INSTALL_DIR" || ! -w "$INSTALL_DIR" ]]; then
  echo "$INSTALL_DIR is not writable. Set LOOM_DESKTOP_INSTALL_DIR to another Applications folder and run again."
  exit 1
fi

# Auto-quit any running Loomola (any LoomDesktop process, not just
# the installed one) so the installer can replace the bundle. Used
# to bail with "Quit it then re-run" — too easy to miss in a
# scrollback. This is a clean Cmd-Q via AppleScript so the app's
# normal shutdown path runs.
if pgrep -f "LoomDesktop" >/dev/null 2>&1; then
  echo "Loomola is running. Quitting it cleanly first..."
  osascript -e 'quit app "Loomola"' >/dev/null 2>&1 || true
  # Give it 3 seconds to wind down. If it's still alive, kill it.
  for _ in 1 2 3; do
    if ! pgrep -f "LoomDesktop" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if pgrep -f "LoomDesktop" >/dev/null 2>&1; then
    echo "  Forcing termination..."
    pkill -f "LoomDesktop" || true
    sleep 1
  fi
fi

echo
echo "===================================="
echo "Loomola installer"
HEAD_COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [[ "$HEAD_COMMIT" != "unknown" ]] && ! git -C "$REPO_ROOT" diff --quiet --ignore-submodules HEAD -- 2>/dev/null; then
  HEAD_COMMIT="$HEAD_COMMIT-dirty"
fi
HEAD_TITLE="$(git -C "$REPO_ROOT" log -1 --pretty=%s 2>/dev/null || echo)"
echo "  About to install commit: $HEAD_COMMIT"
echo "  ($HEAD_TITLE)"
echo "===================================="
echo

# Bootstrap the stable signing identity once. This avoids the TCC
# password-storm on every rebuild (Camera / Mic / Screen Recording
# / Accessibility grants persist when the code signature is stable).
"$ROOT_DIR/scripts/setup-signing-identity.sh"

echo "Building $APP_NAME for local installation..."
LOOM_DESKTOP_APP_PATH="$BUILD_APP_PATH" \
LOOM_DESKTOP_BUILD_CONFIGURATION="${LOOM_DESKTOP_BUILD_CONFIGURATION:-release}" \
  "$ROOT_DIR/scripts/build-dev-app.sh"

if [[ -e "$INSTALLED_APP_PATH" && ! -d "$INSTALLED_APP_PATH/Contents" ]]; then
  echo "$INSTALLED_APP_PATH exists but does not look like an app bundle. Move it aside and run again."
  exit 1
fi

rm -rf "$INSTALLED_APP_PATH"
ditto "$BUILD_APP_PATH" "$INSTALLED_APP_PATH"
xattr -dr com.apple.quarantine "$INSTALLED_APP_PATH" 2>/dev/null || true

# Verify the just-installed bundle's stamp matches HEAD. If it
# doesn't, something cached or skipped a build step — print loud.
INSTALLED_COMMIT="$(defaults read "$INSTALLED_APP_PATH/Contents/Resources/DesktopConfig.plist" LOOM_BUILD_COMMIT 2>/dev/null || echo unknown)"
echo
echo "===================================="
echo "Installed $APP_NAME to $INSTALLED_APP_PATH"
echo "  Bundle commit:  $INSTALLED_COMMIT"
echo "  Source HEAD:    $HEAD_COMMIT"
if [[ "$INSTALLED_COMMIT" != "$HEAD_COMMIT" && "$INSTALLED_COMMIT" != "unknown" ]]; then
  echo "  ⚠️  MISMATCH — installed bundle does not match source HEAD"
fi
echo "===================================="
echo
echo "Launching $APP_NAME..."
open "$INSTALLED_APP_PATH"
