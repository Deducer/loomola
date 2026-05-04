#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ps -ax -o comm= | grep -q '/LoomDesktop$'; then
  echo "Loomola is already running."
  echo "Quit the existing Loomola window before starting a new dev build."
  exit 1
fi

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

if [[ -f .env.local ]]; then
  echo "Reading desktop/.env.local"
fi

if [[ -f ../.env.local ]]; then
  echo "Reading ../.env.local"
fi

set_env_from_file LOOM_SUPABASE_URL .env.local LOOM_SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_URL
set_env_from_file LOOM_SUPABASE_ANON_KEY .env.local LOOM_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_ANON_KEY
set_env_from_file LOOM_API_BASE_URL .env.local LOOM_API_BASE_URL
set_env_from_file LOOM_SUPABASE_URL ../.env.local LOOM_SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_URL
set_env_from_file LOOM_SUPABASE_ANON_KEY ../.env.local LOOM_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_ANON_KEY
set_env_from_file LOOM_API_BASE_URL ../.env.local LOOM_API_BASE_URL

export LOOM_API_BASE_URL="${LOOM_API_BASE_URL:-https://loom.dissonance.cloud}"

if [[ -z "${LOOM_SUPABASE_URL:-}" || -z "${LOOM_SUPABASE_ANON_KEY:-}" ]]; then
  echo "Missing LOOM_SUPABASE_URL or LOOM_SUPABASE_ANON_KEY."
  echo "Create desktop/.env.local from desktop/.env.example, or pass them as environment variables."
  exit 1
fi

echo "Using API base: ${LOOM_API_BASE_URL}"
echo "Building Loomola dev app bundle..."
./scripts/build-dev-app.sh

APP_PATH="${LOOM_DESKTOP_APP_PATH:-"$PWD/.build/LoomDesktop.app"}"
echo "Launching Loomola dev app bundle..."
exec "$APP_PATH/Contents/MacOS/LoomDesktop"
