'use strict';

/*
 * Быстрый набор по деталям: только из готовых красок и компактнее.
 *
 * 1. Сервер: /api/norms/quick принимает recipe=<название готовой краски>
 *    и считает микс краски по составу готовой краски.
 * 2. Клиент: вместо поиска краски — выпадающий список готовых красок.
 *
 *   node tools/patch-quick-recipe.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverFile = path.join(root, 'server', 'server.js');
const appFile = path.join(root, 'server', 'public', 'app.js');

let server = fs.readFileSync(serverFile, 'utf8');
let app = fs.readFileSync(appFile, 'utf8');
let changed = 0;

/* ---------- 1. Сервер: расчёт по готовой краске ---------- */

if (!server.includes('recipeName')) {
  const marker = [
    "  const parts = Math.max(0.01, toNum(url.searchParams.get('parts'), 1));",
    "  const paintCode = str(url.searchParams.get('paint'), 40).toUpperCase();"
  ].join('\r\n');

  const replacement = [
    "  const parts = Math.max(0.01, toNum(url.searchParams.get('parts'), 1));",
    "  const paintCode = str(url.searchParams.get('paint'), 40).toUpperCase();",
    "  const recipeName = str(url.searchParams.get('recipe'), 200);",
    '',
    '  // Готовая краска: её состав раскладываем на микс по деталям',
    '  let recipe = null;',
    '',
    '  if (recipeName) {',
    "    const all = db.prepare('SELECT * FROM recipes').all().map(recipeOut);",
    '    const needle = normalizeSearch(recipeName);',
    '',
    '    recipe = all.find((row) => normalizeSearch(row.name) === needle)',
    '      || all.find((row) => normalizeSearch(row.name).includes(needle))',
    '      || null;',
    '  }'
  ].join('\r\n');

  if (!server.includes(marker)) {
    console.error('сервер: не нашёл начало /api/norms/quick');
    process.exit(1);
  }

  server = server.replace(marker, replacement);

  // строка «краска»: из готовой краски вместо кода материала
  const paintBlock = [
    "    if (norm.role === 'paint') {",
    '      if (!paintCode) continue;',
    '',
    "      const material = db.prepare('SELECT code, name FROM materials WHERE upper(code) = ?').get(paintCode);",
    '      if (!material) continue;',
    '',
    '      code = material.code;',
    '      name = material.name;',
    '    }'
  ].join('\r\n');

  const paintBlockNew = [
    "    if (norm.role === 'paint') {",
    '      // Краска берётся только из готовой краски',
    '      if (!recipe) continue;',
    '',
    '      const paintNorm = round2(Number(norm.qty) * (norm.per === \'order\' ? 1 : parts));',
    '      const scale = recipe.base > 0 ? paintNorm / recipe.base : 0;',
    '',
    "      for (const mix of recipe.mixes || []) {",
    '        const mixQty = round2(Number(mix.amount) * scale);',
    '        if (!(mixQty > 0)) continue;',
    '',
    '        const mixStock = db.prepare(`',
    '          SELECT m.stock, m.unit,',
    '                 COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = m.code), 0) AS used',
    '            FROM materials m WHERE m.code = ?',
    '        `).get(mix.code);',
    '',
    '        rows.push({',
    '          code: mix.code,',
    '          name: mix.name,',
    "          unit: (mixStock && mixStock.unit) || 'г',",
    '          qty: mixQty,',
    '          per: norm.per,',
    "          role: 'paint',",
    '          recipe: recipe.name,',
    '          left_after: mixStock',
    '            ? round2((Number(mixStock.stock) || 0) - (Number(mixStock.used) || 0) - mixQty)',
    '            : null',
    '        });',
    '      }',
    '',
    '      continue;',
    '    }'
  ].join('\r\n');

  if (!server.includes(paintBlock)) {
    console.error('сервер: не нашёл блок строки краски');
    process.exit(1);
  }

  server = server.replace(paintBlock, paintBlockNew);

  // в ответ добавляем название готовой краски
  server = server.replace(
    '  return { parts, personal, items: rows };',
    "  return { parts, personal, recipe: recipe ? recipe.name : null, items: rows };"
  );

  changed++;
  console.log('сервер: расчёт по готовой краске');
} else {
  console.log('сервер: уже пропатчен');
}

fs.writeFileSync(serverFile, server);
fs.writeFileSync(appFile, app);
console.log('изменений:', changed);
