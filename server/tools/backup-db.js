'use strict';

/*
 * Снимок базы для бэкапа.
 *
 *   node tools/backup-db.js /tmp/paint-backup.db
 *
 * VACUUM INTO делает цельный файл, даже если в этот момент кто-то работает
 * (обычное копирование .db при включённом WAL может дать битый файл).
 */

const path = require('node:path');
const fs = require('node:fs');

process.env.PAINT_QUIET = '1';

const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.PAINT_DB || path.join(__dirname, '..', 'data', 'paint.db');

const target = process.argv[2] || path.join('/tmp', 'paint-backup.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('Нет файла базы:', DB_PATH);
  process.exit(1);
}

// Старый снимок удаляем, иначе VACUUM INTO откажется писать
try {
  fs.unlinkSync(target);
} catch (error) {
  /* файла нет — и хорошо */
}

const db = new DatabaseSync(DB_PATH);

try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const stat = fs.statSync(target);
console.log(JSON.stringify({ ok: true, file: target, bytes: stat.size }));
