'use strict';

/*
 * Переносит в CRM то, что сделали для бланков:
 *   1) остатки материалов (materials.stock) по отчёту склада;
 *   2) избранные материалы у каждого пользователя (таблица favorites).
 *
 *   node tools/apply-crm-stock.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dbFile = path.join(root, 'server', 'db.js');
let db = fs.readFileSync(dbFile, 'utf8').replace(/\r\n/g, '\n');

let changed = 0;

/* 1. Таблица избранного */
if (!db.includes('CREATE TABLE IF NOT EXISTS favorites')) {
  db = db.replace(
    'CREATE TABLE IF NOT EXISTS norms (',
    `CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, code)
);

CREATE TABLE IF NOT EXISTS norms (`
  );
  changed++;
  console.log('db.js: таблица favorites');
}

/* 2. Колонка остатка */
if (!db.includes("addColumn('materials', 'stock'")) {
  db = db.replace(
    "addColumn('materials', 'aliases', 'TEXT');",
    "addColumn('materials', 'aliases', 'TEXT');\naddColumn('materials', 'stock', 'REAL');"
  );
  changed++;
  console.log('db.js: колонка materials.stock');
}

/* 3. Загрузка остатков из отчёта склада (один раз) */
if (!db.includes('stock-from-report')) {
  const anchor = '  // Работы измеряются в деталях: капот — 1, большой капот — 1,5';

  const block = `  // Остатки со склада: разово переносим из отчёта (server/data-stock.json)
  const stockApplied = db.prepare("SELECT value FROM settings WHERE key = 'stock-from-report'").get();

  if (!stockApplied) {
    const stockFile = path.join(__dirname, 'data-stock.json');

    if (fs.existsSync(stockFile)) {
      const stockRows = JSON.parse(fs.readFileSync(stockFile, 'utf8'));
      const setStock = db.prepare('UPDATE materials SET stock = ?, unit = ? WHERE code = ?');

      let applied = 0;
      for (const row of stockRows) {
        const info = setStock.run(Number(row.stock) || 0, row.unit || 'шт', row.code);
        if (info.changes > 0) applied++;
      }

      console.log('остатки со склада применены:', applied);
    }

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('stock-from-report', '1')").run();
  }

${anchor}`;

  if (!db.includes(anchor)) {
    console.error('не нашёл место для загрузки остатков');
    process.exit(1);
  }

  db = db.replace(anchor, block);
  changed++;
  console.log('db.js: загрузка остатков из отчёта');
}

fs.writeFileSync(dbFile, db);
console.log('изменений:', changed);
