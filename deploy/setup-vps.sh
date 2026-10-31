#!/usr/bin/env bash
# One-time setup for a fresh Munjai Ubuntu 22.04/24.04 VPS. Run as root:
#   sudo bash deploy/setup-vps.sh
set -euo pipefail

echo "==> Updating packages"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw fail2ban

echo "==> Installing Docker Engine + Compose plugin (official Docker apt repo)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Fail2Ban for SSH"
systemctl enable --now fail2ban

echo "==> Timezone"
timedatectl set-timezone Asia/Bangkok

echo "Done. Next: cd deploy && cp .env.example .env && nano .env && docker compose up -d --build"
