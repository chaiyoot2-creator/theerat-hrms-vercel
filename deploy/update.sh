#!/usr/bin/env bash
# Pull the latest code and rebuild the API: bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
cd deploy
docker compose up -d --build
docker compose ps
