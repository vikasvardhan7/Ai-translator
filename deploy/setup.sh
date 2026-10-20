#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

step() {
  printf '\n== %s\n' "$1"
}

step "Opening the web ports 80 and 443 in this server's firewall"
if sudo iptables -C INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null; then
  echo "Already open."
else
  sudo iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j ACCEPT
  if command -v netfilter-persistent >/dev/null 2>&1; then
    sudo netfilter-persistent save
  fi
  echo "Opened."
fi

memory_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$memory_kb" -lt 3000000 ] && [ -z "$(swapon --show --noheadings)" ]; then
  step "Adding 2 GB of swap so the app can be built on a small server"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  step "Installing Docker"
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
fi

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  step "Next: fill in your settings"
  echo "Open the settings file with:  nano .env"
  echo "Fill in DOMAIN, DUCKDNS_SUBDOMAIN, DUCKDNS_TOKEN, GEMINI_API_KEY, GEMINI_MODEL,"
  echo "SMTP_USERNAME and SMTP_PASSWORD. Save with Ctrl+O, Enter, then Ctrl+X."
  echo "Then run this again:  bash setup.sh"
  exit 0
fi

missing=()
for name in DOMAIN GEMINI_API_KEY SMTP_USERNAME SMTP_PASSWORD; do
  if ! grep -Eq "^${name}=.+" .env; then
    missing+=("$name")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "These are still empty in deploy/.env: ${missing[*]}"
  echo "Open it with:  nano .env   then run:  bash setup.sh"
  exit 1
fi

step "Building and starting the app (the first build takes a few minutes)"
sudo docker compose up -d --build

domain=$(grep -E '^DOMAIN=' .env | head -n 1 | cut -d= -f2- | tr -d '[:space:]')
step "Done"
echo "Open https://${domain} (the https certificate can take a minute the first time)."
echo "Check it is running:  sudo docker compose ps"
echo "See what it says:     sudo docker compose logs --tail 50 app"
