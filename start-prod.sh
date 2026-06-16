#!/bin/bash
# Wrapper that loads .env then starts the API server.
# Used by PM2 (ecosystem.config.cjs) because PM2 v7 env_file is unreliable.
set -a
# shellcheck disable=SC1091
source "$(dirname "$0")/.env"
set +a
exec node --enable-source-maps \
  "$(dirname "$0")/artifacts/api-server/dist/index.mjs"
