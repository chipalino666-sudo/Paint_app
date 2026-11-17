'use strict';

/*
 * Добавляет в новую базу позицию, которой нет в отчёте.
 *
 *   node tools/add-item.js <КОД> "<НАИМЕНОВАНИЕ>" <КАТЕГОРИЯ> <ОСТАТОК> [единица]
 *
 * Пример:
 *   node tools/add-item.js SE313518 "Салфетка липкая A1 Super wave" consumable 100
 */

const fs = require('node:fs');
const path = require('node:path');

const [code, name, category, stockRaw, unit = ''] = process.argv.slice(2);

if (!code || !name || !category || stockRaw === undefined) {
  console.error('Нужны: код, наименование, категория, остаток');
  process.exit(1);
}

const file = path.join(__dirname, '..', 'Photo', 'parsed', 'final.json');
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

const exists = rows.find((row) => row.code === code);

if (exists) {
  console.log('такой код уже есть:', exists.code, '—', exists.name);
  process.exit(0);
}

rows.push({
  code,
  name,
  category,
  unit,
  stock: Number(stockRaw),
  source_qty: String(stockRaw)
});

rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');

console.log('добавлено:', code, '—', name, '—', stockRaw, unit || '(без единицы)');
console.log('всего позиций:', rows.length);
