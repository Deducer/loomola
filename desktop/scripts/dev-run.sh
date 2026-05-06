#!/usr/bin/env bash
# Fast dev iteration. Builds the .app bundle with the same stable
# codesign identity as the installer, then launches it directly
# from desktop/.build/ — no copy to /Applications, no quit/relaunch
# dance, no admin prompts.
#
# Why it works: TCC keys grants (Camera / Mic / Screen Recording /
# Accessibility) by the code signature requirement, which the
# stable "Loomola Local Signing" cert keeps the same across every
# rebuild. As long as you've granted permissions once (to either
# the installed app at /Applications/Loomola.app or any prior
# .build/Loomola.app), this script's output inherits them.
#
# Use `./scripts/install-local-app.sh` only when you actually want
# to test the installed-app experience (Dock launch, post-restart
# behavior, etc.).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
APP_NAME="${LOOM_DESKTOP_APP_NAME:-Loomola}"
BUILD_APP_PATH="$ROOT_DIR/.build/$APP_NAME.app"

read_env_value() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "${line}" ]]; then return 1; fi
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
  if [[ -n "${!target:-}" || ! -f "${file}" ]]; then return; fi
  local key
  for key in "$@"; do
    local value
    value="$(read_env_value "${file}" "${key}" || true)"
    if [[ -n "${value}" ]]; then export "${target}=${value}"; return; fi
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

# Auto-quit any running Loomola — same as the installer. Avoids
# launching a second instance.
if pgrep -f "LoomDesktop" >/dev/null 2>&1; then
  echo "Quitting running Loomola..."
  osascript -e 'quit app "Loomola"' >/dev/null 2>&1 || true
  for _ in 1 2 3; do
    if ! pgrep -f "LoomDesktop" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if pgrep -f "LoomDesktop" >/dev/null 2>&1; then
    pkill -f "LoomDesktop" || true
    sleep 1
  fi
fi

# Bootstrap stable signing identity (idempotent).
"$ROOT_DIR/scripts/setup-signing-identity.sh"

HEAD_COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [[ "$HEAD_COMMIT" != "unknown" ]] && ! git -C "$REPO_ROOT" diff --quiet --ignore-submodules HEAD -- 2>/dev/null; then
  HEAD_COMMIT="$HEAD_COMMIT-dirty"
fi
echo
echo "Building $APP_NAME (debug) at commit $HEAD_COMMIT..."
LOOM_DESKTOP_APP_PATH="$BUILD_APP_PATH" \
LOOM_DESKTOP_BUILD_CONFIGURATION="${LOOM_DESKTOP_BUILD_CONFIGURATION:-debug}" \
  "$ROOT_DIR/scripts/build-dev-app.sh"

echo
echo "Launching $BUILD_APP_PATH"
open "$BUILD_APP_PATH"
