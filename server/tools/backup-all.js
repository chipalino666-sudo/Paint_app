'use strict';

/*
 * Полный снимок для бэкапа: база + загруженные файлы (фото, ТДС) + настройки.
 *
 *   node tools/backup-all.js
 *
 * Печатает JSON: путь к архиву и размеры.
 *
 * Архив содержит:
 *   paint.db      — цельный снимок базы (VACUUM INTO, можно копировать на ходу)
 *   uploads/      — фото заказов, паспорта, документы
 *   env.txt       — настройки сервера (ключ ИИ и прочее), для восстановления
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.PAINT_DATA || path.join(ROOT, 'data');
const DB_PATH = process.env.PAINT_DB || path.join(DATA_DIR, 'paint.db');
const UPLOADS = process.env.PAINT_UPLOADS || path.join(DATA_DIR, 'uploads');
const ENV_FILE = path.join(ROOT, '.env');

if (!fs.existsSync(DB_PATH)) {
  console.error(JSON.stringify({ ok: false, error: 'нет файла базы: ' + DB_PATH }));
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const workDir = fs.mkdtempSync('/tmp/lonjeron-bk-');
const snapPath = path.join(workDir, 'paint.db');
const archive = `/tmp/lonjeron-backup-${stamp}.tar.gz`;

// 1. Снимок базы
const db = new DatabaseSync(DB_PATH);

try {
  db.exec(`VACUUM INTO '${snapPath.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

// 2. Настройки (без них после восстановления придётся всё вводить заново)
if (fs.existsSync(ENV_FILE)) {
  fs.copyFileSync(ENV_FILE, path.join(workDir, 'env.txt'));
}

// 3. Архив: база + настройки + загрузки
const args = ['-czf', archive, '-C', workDir, 'paint.db'];

if (fs.existsSync(path.join(workDir, 'env.txt'))) {
  args.push('env.txt');
}

if (fs.existsSync(UPLOADS) && fs.readdirSync(UPLOADS).length) {
  args.push('-C', path.dirname(UPLOADS), path.basename(UPLOADS));
}

execFileSync('tar', args);

const dbBytes = fs.statSync(snapPath).size;
const archiveBytes = fs.statSync(archive).size;

let uploadsBytes = 0;

if (fs.existsSync(UPLOADS)) {
  for (const name of fs.readdirSync(UPLOADS)) {
    try {
      uploadsBytes += fs.statSync(path.join(UPLOADS, name)).size;
    } catch (error) {
      /* пропускаем нечитаемое */
    }
  }
}

// 4. Убираем временную папку
fs.rmSync(workDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  file: archive,
  bytes: archiveBytes,
  db_bytes: dbBytes,
  uploads_bytes: uploadsBytes
}));
