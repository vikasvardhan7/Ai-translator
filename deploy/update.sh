#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

git pull --ff-only
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null
sudo docker compose ps
