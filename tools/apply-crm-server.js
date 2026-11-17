'use strict';

/*
 * Серверная часть остатков и избранного для CRM.
 *
 *   node tools/apply-crm-server.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'server.js');
let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

let changed = 0;

/* 1. Остаток в выдаче поиска материалов */
const oldSelect = '    SELECT code, name, unit, category, price, paint_code, aliases\n      FROM materials';

const newSelect = [
  '    SELECT code, name, unit, category, price, paint_code, aliases, stock,',
  '           COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = materials.code), 0) AS used',
  '      FROM materials'
].join('\n');

if (src.includes(oldSelect)) {
  src = src.replace(oldSelect, newSelect);
  changed++;
  console.log('server.js: остаток в поиске материалов');
} else {
  console.log('server.js: SELECT не найден');
}

/* 2. Отдаём остаток в ответе */
const oldReturn = '  return { materials };';

const newReturn = [
  '  // Остаток: склад минус всё, что уже списано в заказах',
  '  for (const row of materials) {',
  '    row.stock_left = round2((Number(row.stock) || 0) - (Number(row.used) || 0));',
  '  }',
  '',
  '  return { materials };'
].join('\n');

if (src.includes(oldReturn)) {
  src = src.replace(oldReturn, newReturn);
  changed++;
  console.log('server.js: расчёт остатка');
}

/* 3. Избранное */
if (!src.includes("/api/favorites'")) {
  const routes = [
    '/* ---- Избранные материалы ------------------------------------------------ */',
    '',
    "route('GET', '/api/favorites', async ({ user }) => {",
    '  const rows = db.prepare(`',
    '    SELECT f.code, m.name, m.unit, m.stock,',
    '           COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = m.code), 0) AS used',
    '      FROM favorites f',
    '      LEFT JOIN materials m ON m.code = f.code',
    '     WHERE f.user_id = ?',
    '     ORDER BY f.created_at DESC',
    '  `).all(user.id);',
    '',
    '  return {',
    '    favorites: rows.map((row) => ({',
    '      code: row.code,',
    "      name: row.name || row.code,",
    "      unit: row.unit || 'шт',",
    '      stock_left: round2((Number(row.stock) || 0) - (Number(row.used) || 0))',
    '    }))',
    '  };',
    '});',
    '',
    "route('POST', '/api/favorites', async ({ user, body }) => {",
    '  const code = str(body.code, 40);',
    "  if (!code) throw new ApiError(400, 'Не указан материал');",
    '',
    "  db.prepare('INSERT OR IGNORE INTO favorites (user_id, code, created_at) VALUES (?, ?, ?)')",
    '    .run(user.id, code, nowISO());',
    '',
    '  return { ok: true };',
    '});',
    '',
    "route('DELETE', '/api/favorites/:code', async ({ user, params }) => {",
    "  db.prepare('DELETE FROM favorites WHERE user_id = ? AND code = ?').run(user.id, params.code);",
    '  return { ok: true };',
    '});',
    '',
    '/* ---- Перевод кодов красок ------------------------------------------------ */'
  ].join('\n');

  src = src.replace('/* ---- Перевод кодов красок ------------------------------------------------ */', routes);
  changed++;
  console.log('server.js: маршруты избранного');
}

fs.writeFileSync(file, src);
console.log('изменений:', changed);
