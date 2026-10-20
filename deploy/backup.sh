#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

stamp=$(date +%Y-%m-%d-%H%M)
sudo docker compose exec -T app python - <<'PY'
import pathlib
import sqlite3

folder = pathlib.Path("/data/backup")
folder.mkdir(exist_ok=True)
for name in ("accounts", "trainer", "meetings", "keys"):
    source = pathlib.Path(f"/data/{name}.db")
    if source.exists():
        with sqlite3.connect(source) as live, sqlite3.connect(folder / f"{name}.db") as copy:
            live.backup(copy)
PY
mkdir -p backups
sudo docker compose cp app:/data/backup "backups/$stamp"
sudo chown -R "$USER" backups
echo "Saved in deploy/backups/$stamp"
