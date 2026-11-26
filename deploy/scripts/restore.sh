#!/usr/bin/env sh
set -eu
BACKUP_FILE="${1:?Usage: restore.sh <backup.sql> [target_db]}"
TARGET_DB="${2:-${POSTGRES_DB:-marketsphere}}"
docker compose exec -T postgres psql -U "${POSTGRES_USER:-marketsphere}" -d "$TARGET_DB" < "$BACKUP_FILE"
echo "Restored $BACKUP_FILE into $TARGET_DB"
