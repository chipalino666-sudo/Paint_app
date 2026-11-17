'use strict';

/*
 * Добавляет помощнику инструмент low_stock: «что заканчивается на складе».
 *
 *   node tools/patch-ai-lowstock.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'ai-agent.js');
let src = fs.readFileSync(file, 'utf8');
let changed = 0;

/* 1. Инструмент */
if (!src.includes("name: 'low_stock'")) {
  const tool = [
    '  {',
    "    type: 'function',",
    '    function: {',
    "      name: 'low_stock',",
    "      description: 'Показать материалы, которые заканчиваются: остаток дошёл до заданного минимума.',",
    '      parameters: {',
    "        type: 'object',",
    '        properties: {}',
    '      }',
    '    }',
    '  },',
    '  {',
    "    type: 'function',",
    '    function: {',
    "      name: 'find_tds',"
  ].join('\n');

  const anchor = [
    '  {',
    "    type: 'function',",
    '    function: {',
    "      name: 'find_tds',"
  ].join('\n');

  if (!src.includes(anchor)) {
    console.error('не нашёл описание find_tds');
    process.exit(1);
  }

  src = src.replace(anchor, tool);
  changed++;
  console.log('инструмент low_stock описан');
}

/* 2. Реализация */
if (!src.includes('low_stock()')) {
  const impl = [
    '    low_stock() {',
    '      const rows = db.prepare(`',
    '        SELECT m.code, m.name, m.unit, m.stock, m.min_stock,',
    '               COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = m.code), 0) AS used',
    '          FROM materials m',
    '         WHERE m.active = 1 AND COALESCE(m.min_stock, 0) > 0',
    '         ORDER BY m.name',
    '      `).all();',
    '',
    '      const items = [];',
    '',
    '      for (const row of rows) {',
    '        const left = round2((Number(row.stock) || 0) - (Number(row.used) || 0));',
    '        const minStock = round2(Number(row.min_stock) || 0);',
    '',
    '        if (left > minStock) continue;',
    '',
    '        items.push({ name: row.name, code: row.code, left, min: minStock, unit: row.unit });',
    '      }',
    '',
    '      return { count: items.length, items };',
    '    },',
    '',
    '    find_tds({ query }) {'
  ].join('\n');

  const anchor = '    find_tds({ query }) {';

  if (!src.includes(anchor)) {
    console.error('не нашёл реализацию find_tds');
    process.exit(1);
  }

  src = src.replace(anchor, impl);
  changed++;
  console.log('low_stock реализован');
}

/* 3. Правило в инструкции */
if (!src.includes('low_stock')) {
  changed++;
}

fs.writeFileSync(file, src);
console.log('изменений:', changed);
