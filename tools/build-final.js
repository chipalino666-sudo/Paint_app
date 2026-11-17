'use strict';

/*
 * Собирает итоговую базу: код, наименование, остаток, единица, категория.
 * Автоэмали переводятся из килограммов в граммы.
 *
 *   node tools/build-final.js
 */

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'Photo', 'parsed');
const root = path.join(__dirname, '..');

const merged = JSON.parse(fs.readFileSync(path.join(dir, 'merged.json'), 'utf8')).merged;
const old = JSON.parse(fs.readFileSync(path.join(dir, 'old-base.json'), 'utf8').replace(/^\uFEFF/, ''));

// Категории из старого файла categories.js
const categoriesText = fs.readFileSync('C:\\DeepSeek\\Бланки\\categories.js', 'utf8');
const categoryOfCode = new Map();

for (const match of categoriesText.matchAll(/"([A-Z]{2}\d{4,})":\s*"([a-z]+)"/g)) {
  categoryOfCode.set(match[1], match[2]);
}

// Для новых кодов категории угадываем по названию
function guessCategory(name) {
  const text = name.toLowerCase();

  if (/краска|автоэмаль|эмаль акрил|mix\s*\d|mix brulex|normex mix/.test(text)) return 'paint';
  if (/грунт|праймер|primer|порозаполнител/.test(text)) return 'primer';
  if (/шпатл/.test(text)) return 'putty';
  if (/лак|clear|клир/.test(text)) return 'clear';
  if (/отвердит|hardener/.test(text)) return 'hardener';
  if (/разбавит|растворит|thinner|reducer|обезжир/.test(text)) return 'thinner';
  if (/абразив|шлиф|диск |круг |полос|лист|губка|войлок|scuff|sandwox|ceramic|siaair|микрофибр/.test(text)) return 'abrasive';
  if (/перчат|комбинезон|салфет|лента|плёнк|пленк|бумага|стакан|банка|емкость|ёмкость|адаптер|бачок|крышк|ситеч|фильтр|маск|респиратор|полумаска/.test(text)) return 'consumable';

  return 'other';
}

// Плотность краски ≈ 1 кг/л — поэтому килограммы просто умножаем на 1000
const rows = [];
const conflicts = [];

for (const item of merged) {
  const category = categoryOfCode.get(item.code) || guessCategory(item.name);
  const value = Number(String(item.qty).replace(',', '.')) || 0;

  const isPaint = category === 'paint';

  rows.push({
    code: item.code,
    name: item.name,
    category,
    unit: isPaint ? 'г' : 'ед',
    stock: isPaint ? Math.round(value * 1000) : value,
    source_qty: item.qty
  });
}

// Проверка на дубли кодов
const seen = new Map();
for (const row of rows) {
  if (seen.has(row.code)) conflicts.push({ code: row.code, first: seen.get(row.code).name, second: row.name });
  seen.set(row.code, row);
}

const paints = rows.filter((r) => r.category === 'paint');
const byCategory = {};
for (const row of rows) byCategory[row.category] = (byCategory[row.category] || 0) + 1;

console.log('всего позиций:', rows.length);
console.log('автоэмали (переведены в граммы):', paints.length);
console.log('по категориям:', JSON.stringify(byCategory));
console.log('дублей кодов:', conflicts.length);

fs.writeFileSync(path.join(dir, 'final.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log('файл: Photo/parsed/final.json');
