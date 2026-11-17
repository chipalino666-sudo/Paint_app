'use strict';

/*
 * Собирает файлы данных для бланковой программы:
 *   database.js   — код, наименование, остаток, единица
 *   categories.js — распределение по категориям
 *
 *   node tools/make-db.js <папка PaintApp_mini>
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
if (!root) {
  console.error('Укажите папку репозитория');
  process.exit(1);
}

const rows = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'Photo', 'parsed', 'final.json'), 'utf8')
);

const esc = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// database.js
const dbLines = rows.map((row) => {
  const unit = row.unit === 'г' ? ', unit: "г"' : '';
  return `{ code: "${esc(row.code)}", name: "${esc(row.name)}", stock: ${row.stock}${unit} }`;
});

const dbContent = `/* База материалов склада.
   Остаток указан в единицах хранения: автоэмали — в граммах, остальное — как в отчёте.
   Данные на 16 ноября 2026 года. */

const database = [
${dbLines.join(',\n')}
];
`;

fs.writeFileSync(path.join(root, 'database.js'), dbContent, 'utf8');

// categories.js
const catLines = rows.map((row) => `  "${esc(row.code)}": "${row.category}"`);

const catContent = `// Категории материалов. Ключ — код из database.js, значение — id категории.
const ITEM_CATEGORY = {
${catLines.join(',\n')}
};
`;

fs.writeFileSync(path.join(root, 'categories.js'), catContent, 'utf8');

console.log('позиций:', rows.length);
console.log('database.js:', Math.round(dbContent.length / 1024), 'КБ');
console.log('categories.js:', Math.round(catContent.length / 1024), 'КБ');
