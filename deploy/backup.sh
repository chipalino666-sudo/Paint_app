#!/usr/bin/env bash
#
# Ежедневная резервная копия базы. Запускается из cron в 03:15.
# Хранит 14 последних копий в /var/backups/paint.

set -euo pipefail

DB=/opt/paint/server/data/paint.db
BACKUP_DIR=/var/backups/paint
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB" ]; then
    echo "База не найдена: $DB" >&2
    exit 1
fi

STAMP="$(date +%F-%H%M)"
TARGET="$BACKUP_DIR/paint-$STAMP.db"

# VACUUM INTO делает согласованную копию, не останавливая сервер
sqlite3 "$DB" "VACUUM INTO '$TARGET'"

find "$BACKUP_DIR" -name 'paint-*.db' -mtime +"$KEEP_DAYS" -delete

echo "Копия: $TARGET"
