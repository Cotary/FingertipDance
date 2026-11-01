#!/bin/bash
# PostgreSQL 每日备份脚本。放到 /etc/cron.daily/backup-pg 并 chmod +x。
# 依赖环境变量 DB_PASSWORD（或从 .env 读取）。保留最近 7 天。
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
mkdir -p "$BACKUP_DIR"

# 容器名按实际调整（docker compose 项目名 fgame 时通常为 fgame-postgres-1）
CONTAINER="${PG_CONTAINER:-fgame-postgres-1}"
USER="${PG_USER:-fgame}"
PASSWORD="${DB_PASSWORD:?DB_PASSWORD 未设置}"

docker exec -e PGPASSWORD="$PASSWORD" "$CONTAINER" pg_dump -U "$USER" fgame \
  | gzip > "$BACKUP_DIR/fgame-$(date +%F).sql.gz"

find "$BACKUP_DIR" -name "fgame-*.sql.gz" -mtime +7 -delete

echo "备份完成: $BACKUP_DIR/fgame-$(date +%F).sql.gz"
