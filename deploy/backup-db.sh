#!/usr/bin/env bash
# Nightly PostgreSQL dump, keeps 14 days. Install in root's crontab:
#   0 2 * * * /opt/theerat-hrms/deploy/backup-db.sh >> /var/log/hrms-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
docker compose exec -T db pg_dump -U hrms -d hrms --format=custom > "backups/hrms-$(date +%F-%H%M).dump"
find backups -name 'hrms-*.dump' -mtime +14 -delete
echo "$(date -Is) backup ok"
