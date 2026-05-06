#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Compiling loomola-migrate (arm64 macOS)..."
bun build \
  --compile \
  --target=bun-darwin-arm64 \
  --outfile=loomola-migrate \
  src/cli.ts

echo "→ Ad-hoc signing..."
codesign --force --sign - ./loomola-migrate

echo "✓ Built ./migrate/loomola-migrate"
file ./loomola-migrate
ls -lh ./loomola-migrate
