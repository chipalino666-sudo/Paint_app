#!/usr/bin/env bash
#
# Ежедневная резервная копия: база + загруженные фотографии.
# Запускается из cron в 03:15. Хранит 14 последних копий в /var/backups/paint.

set -euo pipefail

DB=/opt/paint/server/data/paint.db
UPLOADS=/opt/paint/server/data/uploads
BACKUP_DIR=/var/backups/paint
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB" ]; then
    echo "База не найдена: $DB" >&2
    exit 1
fi

STAMP="$(date +%F-%H%M)"

# 1. База: VACUUM INTO делает согласованную копию, не останавливая сервер
sqlite3 "$DB" "VACUUM INTO '$BACKUP_DIR/paint-$STAMP.db'"

# 2. Фотографии: складываем в архив рядом с базой
if [ -d "$UPLOADS" ] && [ -n "$(ls -A "$UPLOADS" 2>/dev/null)" ]; then
    tar -czf "$BACKUP_DIR/photos-$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" uploads
    echo "Копия фото: $BACKUP_DIR/photos-$STAMP.tar.gz"
else
    echo "Фотографий пока нет — архив не нужен"
fi

# 3. Чистим старое
find "$BACKUP_DIR" -name 'paint-*.db' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'photos-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "Копия базы: $BACKUP_DIR/paint-$STAMP.db"
