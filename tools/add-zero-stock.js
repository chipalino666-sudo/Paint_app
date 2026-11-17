'use strict';

/*
 * Добавляет в новую базу эмали, которых нет в отчёте, с нулевым остатком.
 * 583 / 598 / 845 не добавляем: они есть в новой базе под именами Brulex 127 / 138 / 214,
 * и перекрёстный поиск находит их по обоим кодам.
 *
 *   node tools/add-zero-stock.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'Photo', 'parsed', 'final.json');
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

const add = [
  { code: 'SE281171', name: 'Краска Normex MIX 432 B 1 л' },
  { code: 'SE281174', name: 'Краска Normex MIX 792 P 1 л' },
  { code: 'SE276774', name: 'Краска Normex MIX 795' }
];

let added = 0;

for (const item of add) {
  if (rows.some((row) => row.code === item.code)) continue;

  rows.push({
    code: item.code,
    name: item.name,
    category: 'paint',
    unit: 'г',
    stock: 0,
    source_qty: '0'
  });

  added++;
}

rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
console.log('добавлено эмалей с нулём:', added);
console.log('всего позиций:', rows.length);
