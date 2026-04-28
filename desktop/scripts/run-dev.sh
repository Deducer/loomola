#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if pgrep -x LoomDesktop >/dev/null; then
  echo "Loom Desktop is already running."
  echo "Quit the existing Loom Desktop window before starting a new dev build."
  exit 1
fi

if [[ -f .env.local ]]; then
  echo "Loading desktop/.env.local"
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

if [[ -f ../.env.local ]]; then
  echo "Loading ../.env.local"
  set -a
  # shellcheck disable=SC1091
  source ../.env.local
  set +a
fi

export LOOM_SUPABASE_URL="${LOOM_SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-${SUPABASE_URL:-}}}"
export LOOM_SUPABASE_ANON_KEY="${LOOM_SUPABASE_ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-${SUPABASE_ANON_KEY:-}}}"
export LOOM_API_BASE_URL="${LOOM_API_BASE_URL:-https://loom.dissonance.cloud}"

if [[ -z "${LOOM_SUPABASE_URL:-}" || -z "${LOOM_SUPABASE_ANON_KEY:-}" ]]; then
  echo "Missing LOOM_SUPABASE_URL or LOOM_SUPABASE_ANON_KEY."
  echo "Create desktop/.env.local from desktop/.env.example, or pass them as environment variables."
  exit 1
fi

echo "Using API base: ${LOOM_API_BASE_URL}"
echo "Launching Loom Desktop dev build..."
swift run LoomDesktop
