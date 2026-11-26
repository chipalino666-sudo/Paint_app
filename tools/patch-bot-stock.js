'use strict';

/*
 * Бот: полный список материалов с остатками, без обрезки на 8 позициях.
 *
 *   node tools/patch-bot-stock.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'ai-agent.js');
let code = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* ---------- 1. Описание инструмента ---------- */

if (!code.includes("name: 'stock_report'")) {
  const anchor = `  {
    type: 'function',
    function: {
      name: 'low_stock',`;

  if (!code.includes(anchor)) {
    console.error('ai-agent.js: не нашёл место для инструмента');
    process.exit(1);
  }

  const tool = [
    '  {',
    '    type: \'function\',',
    '    function: {',
    "      name: 'stock_report',",
    "      description: 'Полный список материалов с остатками. Используй, когда просят перечислить все краски, лаки, порошки, материалы — с остатками или без.',",
    '      parameters: {',
    "        type: 'object',",
    '        properties: {',
    "          category: {",
    "            type: 'string',",
    "            enum: ['paint', 'clear', 'hardener', 'thinner', 'primer', 'putty', 'abrasive', 'consumable', 'other', 'all'],",
    "            description: 'категория: paint — краски, clear — лаки, hardener — отвердители, thinner — разбавители, all — всё подряд'",
    '          },',
    "          only_with_stock: { type: 'boolean', description: 'только те, где остаток больше нуля' },",
    "          offset: { type: 'integer', description: 'с какой позиции начать (для продолжения списка)' },",
    "          limit: { type: 'integer', description: 'сколько вернуть за раз, по умолчанию 60' }",
    '        }',
    '      }',
    '    }',
    '  },',
    ''
  ].join('\n');

  code = code.replace(anchor, tool + anchor);
  changed++;
  console.log('ai-agent.js: инструмент stock_report');
}

/* ---------- 2. Обработчик ---------- */

if (!code.includes('stock_report({')) {
  const anchor = '    low_stock() {';

  if (!code.includes(anchor)) {
    console.error('ai-agent.js: не нашёл обработчик low_stock');
    process.exit(1);
  }

  const handler = [
    '    stock_report({ category, only_with_stock, offset, limit } = {}) {',
    "      const cat = String(category || 'paint');",
    "      const where = cat && cat !== 'all' ? \" AND category = '\" + cat.replace(/[^a-z]/g, '') + \"'\" : '';",
    '      const start = Math.max(0, Number(offset) || 0);',
    '      const take = Math.min(Math.max(Number(limit) || 60, 1), 300);',
    '',
    '      const rows = db.prepare(`',
    '        SELECT code, name, unit, category, paint_code, stock,',
    '               COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = materials.code), 0) AS used',
    '          FROM materials',
    '         WHERE active = 1${where}',
    '         ORDER BY name',
    '      `).all();',
    '',
    '      const all = rows.map((row) => ({',
    '        code: row.code,',
    '        name: row.name,',
    '        unit: row.unit,',
    '        paint_code: row.paint_code || null,',
    '        left: round2((Number(row.stock) || 0) - (Number(row.used) || 0))',
    '      }));',
    '',
    '      const filtered = only_with_stock ? all.filter((row) => row.left > 0) : all;',
    '      const items = filtered.slice(start, start + take);',
    '',
    '      return {',
    '        total: filtered.length,',
    '        offset: start,',
    '        count: items.length,',
    '        has_more: start + items.length < filtered.length,',
    '        items',
    '      };',
    '    },',
    '',
    anchor
  ].join('\n');

  code = code.replace(anchor, handler);
  changed++;
  console.log('ai-agent.js: обработчик stock_report');
}

/* ---------- 3. Правило в подсказке ---------- */

if (!code.includes('stock_report')) {
  console.log('внимание: правило не добавлено');
} else if (!code.includes('перечислить все')) {
  const promptAnchor = 'Правила:';

  if (code.includes(promptAnchor)) {
    code = code.replace(
      promptAnchor,
      [
        'Правила:',
        '',
        'Когда просят перечислить все краски, лаки или материалы с остатками — вызывай stock_report и покажи ВСЕ позиции из ответа (можно списком). Указывай, сколько всего нашлось (total) и, если has_more, предложи продолжить. Никогда не говори «больше не могу найти», если в ответе есть has_more — просто продолжай с offset.'
      ].join('\n')
    );

    changed++;
    console.log('ai-agent.js: правило про полный список');
  }
}

/* ---------- 4. Поиск: больше вариантов ---------- */

code = code.replace(
  'ORDER BY CASE WHEN category = \'paint\' THEN 0 ELSE 1 END, name\n             LIMIT 8',
  'ORDER BY CASE WHEN category = \'paint\' THEN 0 ELSE 1 END, name\n             LIMIT 25'
);

code = code.replace(
  'ORDER BY name\n             LIMIT 8',
  'ORDER BY name\n             LIMIT 25'
);

code = code.replace('.slice(0, 8);\n      }\n\n      const materials = finalRows.map', '.slice(0, 25);\n      }\n\n      const materials = finalRows.map');

fs.writeFileSync(file, code);
console.log('изменений:', changed);
