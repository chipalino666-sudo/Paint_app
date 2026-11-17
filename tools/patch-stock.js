'use strict';

/*
 * Склад: приход товара, история движений и минимальные остатки.
 * Маршруты лежат отдельным файлом tools/stock-routes.txt — так проще править.
 *
 *   node tools/patch-stock.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'server', 'server.js');

let src = fs.readFileSync(file, 'utf8');
let changed = 0;

const eol = src.includes('\r\n') ? '\r\n' : '\n';
const lines = src.split(/\r?\n/);
const joined = lines.join(eol);

/* 1. Минимальный остаток в выдаче склада */
if (!joined.includes('m.min_stock')) {
  const index = lines.findIndex((line) => line.includes('SELECT m.code, m.name, m.unit, m.category, m.price, m.stock,'));

  if (index < 0) {
    console.error('не нашёл запрос склада');
    process.exit(1);
  }

  lines[index] = lines[index].replace('m.stock,', 'm.stock, m.min_stock,');

  // блок сборки item
  const stockLine = lines.findIndex((line) => line.trim().startsWith('const stock = round2(Number(row.stock)'));
  const pushLine = lines.findIndex((line, i) => i > stockLine && line.trim().startsWith('items.push({'));

  if (stockLine < 0 || pushLine < 0) {
    console.error('не нашёл сборку позиции склада');
    process.exit(1);
  }

  const indent = lines[stockLine].match(/^\s*/)[0];

  for (let i = pushLine; i >= stockLine; i--) lines.splice(i, 1);

  const block = [
    `${indent}const stock = round2(Number(row.stock) || 0);`,
    `${indent}const used = round2(Number(row.used) || 0);`,
    `${indent}const left = round2(stock - used);`,
    `${indent}const minStock = round2(Number(row.min_stock) || 0);`,
    '',
    `${indent}items.push({`,
    `${indent}  code: row.code,`,
    `${indent}  name: row.name,`,
    `${indent}  unit: row.unit,`,
    `${indent}  category: row.category,`,
    `${indent}  price: row.price,`,
    `${indent}  stock,`,
    `${indent}  used,`,
    `${indent}  min_stock: minStock,`,
    `${indent}  low: minStock > 0 && left <= minStock,`,
    `${indent}  left`,
    `${indent}});`
  ];

  lines.splice(stockLine, 0, ...block);

  changed++;
  console.log('склад: минимум и признак «мало»');
}

let out = lines.join(eol);

/* 2. Ручная правка остатка пишется в историю движений */
if (!out.includes("'adjust'")) {
  const marker = "  db.prepare('UPDATE materials SET stock = ? WHERE code = ?').run(stock, material.code);";

  if (!out.includes(marker)) {
    console.error('не нашёл обновление остатка');
    process.exit(1);
  }

  const insert = [
    '  const before = round2((Number(material.stock) || 0) - (Number(used) || 0));',
    '',
    marker,
    '',
    '  if (round2(left - before) !== 0) {',
    '    db.prepare(`INSERT INTO stock_moves (code, kind, qty, price, note, user_id, created_at)',
    "                VALUES (?, 'adjust', ?, 0, ?, ?, ?)`)",
    '      .run(material.code, round2(left - before), `Остаток: ${before} → ${left}`, user.id, nowISO());',
    '  }'
  ].join(eol);

  out = out.replace(marker, insert);
  changed++;
  console.log('остаток: запись в историю движений');
}

/* 3. Маршруты прихода, истории и минимумов */
if (!out.includes('/api/stock/incoming')) {
  const routes = fs.readFileSync(path.join(__dirname, 'stock-routes.txt'), 'utf8').replace(/\r?\n/g, eol);
  const marker = '/** Остаток меняет кладовщик: вводит «сколько есть сейчас». */';

  if (!out.includes(marker)) {
    console.error('не нашёл точку вставки маршрутов');
    process.exit(1);
  }

  out = out.replace(marker, routes);
  changed++;
  console.log('склад: маршруты прихода, истории и минимумов');
}

fs.writeFileSync(file, out);
console.log('изменений:', changed);
