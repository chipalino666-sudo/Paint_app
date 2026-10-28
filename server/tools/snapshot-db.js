'use strict';

/*
 * Согласованный снимок базы: VACUUM INTO можно делать на работающем сервере,
 * в отличие от простого копирования файла (там остаётся WAL).
 *
 *   node tools/snapshot-db.js <куда-положить.db>
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const source = path.join(__dirname, '..', 'data', 'paint.db');
const target = process.argv[2];

if (!target) {
  console.error('Укажите путь для снимка');
  process.exit(1);
}

if (!fs.existsSync(source)) {
  console.error('Нет базы: ' + source);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) fs.unlinkSync(target);

const db = new DatabaseSync(source);
db.prepare('VACUUM INTO ?').run(target);

const orders = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
db.close();

const size = fs.statSync(target).size;
console.log(`  снимок: ${target}`);
console.log(`  заказов: ${orders}, сотрудников: ${users}, размер: ${Math.round(size / 1024)} КБ`);
