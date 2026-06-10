#!/bin/sh
# With DOPPLER_TOKEN set (Ian's Coolify deploy), wrap the command in
# `doppler run` so secrets are injected at boot. Without it (docker-compose /
# plain `docker run --env-file`), exec directly — env vars come from the host.
set -e
if [ -n "$DOPPLER_TOKEN" ]; then
  exec doppler run -- "$@"
fi
exec "$@"
