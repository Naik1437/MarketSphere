#!/usr/bin/env sh
set -eu
BACKUP_FILE="${1:-marketsphere_backup_$(date +%Y%m%d_%H%M%S).sql}"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-marketsphere}" -d "${POSTGRES_DB:-marketsphere}" > "$BACKUP_FILE"
echo "Backup written to $BACKUP_FILE"
