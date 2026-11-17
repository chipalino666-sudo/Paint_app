'use strict';

/*
 * Ищет пропавшие позиции в новой базе по коду цвета и по словам названия.
 *
 *   node tools/find-missing.js
 */

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'Photo', 'parsed');
const merged = JSON.parse(fs.readFileSync(path.join(dir, 'merged.json'), 'utf8'));
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'final.json'), 'utf8'));

const STOP = new Set([
  'в', 'b', 'p', 'л', 'ltr', 'l', 'кг', 'kg', 'мл', 'ml', 'шт', 'и', 'для', 'на', 'с', 'по', 'the'
]);

function words(name) {
  return String(name)
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function colorCode(name) {
  const match = /(?:^|\s)(\d{3})(?=[a-zа-я]|\s|$)/i.exec(String(name));
  return match ? match[1] : '';
}

for (const gone of merged.gone) {
  const goneWords = new Set(words(gone.name));
  const goneCode = colorCode(gone.name);

  const candidates = [];

  for (const row of rows) {
    let score = 0;

    if (goneCode && colorCode(row.name) === goneCode) score += 5;

    const rowWords = new Set(words(row.name));
    let common = 0;
    for (const w of goneWords) if (rowWords.has(w)) common += 1;
    score += common;

    if (score >= 2) candidates.push({ score, code: row.code, name: row.name, stock: row.stock, unit: row.unit || '' });
  }

  candidates.sort((a, b) => b.score - a.score);

  console.log(`\n${gone.code} — ${gone.name}`);

  if (!candidates.length) {
    console.log('   подходящих позиций в новой базе нет');
    continue;
  }

  candidates.slice(0, 3).forEach((c) => {
    console.log(`   ? ${c.code} — ${c.name} (${c.stock} ${c.unit}) — совпадение ${c.score}`);
  });
}
