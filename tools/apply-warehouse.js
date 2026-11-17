'use strict';

/*
 * Вкладка «Склад»: список материалов с остатками виден всем,
 * менять остаток и добавлять материалы может кладовщик и админ.
 *
 *   node tools/apply-warehouse.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
let changed = 0;

/* ---------------- Сервер ---------------- */
const serverFile = path.join(root, 'server', 'server.js');
let server = fs.readFileSync(serverFile, 'utf8').replace(/\r\n/g, '\n');

if (!server.includes("route('GET', '/api/stock'")) {
  const routes = [
    '/* ---- Склад -------------------------------------------------------------- */',
    '',
    '/** Склад видят все сотрудники: сколько чего есть на самом деле. */',
    "route('GET', '/api/stock', async ({ url }) => {",
    "  const q = normalizeSearch(str(url.searchParams.get('q'), 100));",
    '',
    '  const rows = db.prepare(`',
    '    SELECT m.code, m.name, m.unit, m.category, m.price, m.stock,',
    '           COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = m.code), 0) AS used,',
    '           COALESCE((SELECT SUM(om.qty * om.price) FROM order_materials om WHERE om.code = m.code), 0) AS spent',
    '      FROM materials m',
    '     WHERE m.active = 1',
    '     ORDER BY m.name',
    '  `).all();',
    '',
    '  const items = [];',
    '',
    '  for (const row of rows) {',
    "    if (q && !String(row.name || '').toLowerCase().includes(q) && !String(row.code || '').toLowerCase().includes(q)) continue;",
    '',
    '    const stock = round2(Number(row.stock) || 0);',
    '    const used = round2(Number(row.used) || 0);',
    '',
    '    items.push({',
    '      code: row.code,',
    '      name: row.name,',
    '      unit: row.unit,',
    '      category: row.category,',
    '      price: row.price,',
    '      stock,',
    '      used,',
    '      left: round2(stock - used),',
    '      spent: round2(Number(row.spent) || 0)',
    '    });',
    '  }',
    '',
    '  return { items };',
    '});',
    '',
    '/** Остаток меняет кладовщик: выставляем «сколько есть сейчас». */',
    "route('PATCH', '/api/stock/:code', async ({ user, params, body }) => {",
    "  if (!isStaff(user)) throw new ApiError(403, 'Остатки меняет кладовщик или админ');",
    '',
    "  const material = db.prepare('SELECT * FROM materials WHERE code = ?').get(params.code);",
    "  if (!material) throw new ApiError(404, 'Материал не найден');",
    '',
    '  const used = db.prepare(',''',
    '    SELECT COALESCE(SUM(qty), 0) AS n FROM order_materials WHERE code = ?',
    "  `).get(material.code).n;",
    '',
    '  // В базе храним «сколько было на складе», а кладовщик вводит «сколько осталось»',
    '  const left = Math.max(0, toNum(body.left, 0));',
    '  const stock = round2(left + (Number(used) || 0));',
    '',
    "  db.prepare('UPDATE materials SET stock = ? WHERE code = ?').run(stock, material.code);",
    '',
    '  audit(user.id, ' + "'stock'" + ', ' + "'material'" + ', null, {',
    '    code: material.code,',
    '    text: `Склад: «${material.name}» остаток ${left} ${material.unit}`',
    '  });',
    '',
    '  return { ok: true, left };',
    '});',
    '',
    '/** Новый материал на склад добавляет кладовщик или админ. */',
    "route('POST', '/api/stock', async ({ user, body }) => {",
    "  if (!isStaff(user)) throw new ApiError(403, 'Материалы добавляет кладовщик или админ');",
    '',
    '  const name = str(body.name, 300);',
    "  if (!name) throw new ApiError(400, 'Укажите наименование');",
    '',
    '  const code = str(body.code, 40) || `MAN-${Date.now().toString(36).toUpperCase()}`;',
    "  const unit = str(body.unit, 10) || 'шт';",
    "  const category = str(body.category, 30) || 'other';",
    '  const price = round2(toNum(body.price, 0));',
    '  const stock = Math.max(0, toNum(body.stock, 0));',
    '',
    "  const exists = db.prepare('SELECT code FROM materials WHERE code = ?').get(code);",
    "  if (exists) throw new ApiError(400, 'Такой код уже есть');",
    '',
    '  db.prepare(`INSERT INTO materials (code, name, unit, category, price, stock, active, synced_at, search)',
    '              VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)',
    '    .run(code, name, unit, category, price, stock, nowISO(), normalizeSearch(code, name));',
    '',
    "  audit(user.id, 'create', 'material', null, { text: `На склад добавлен «${name}»` });",
    '',
    '  return { ok: true, code };',
    '});',
    '',
    '/* ---- Готовые краски ----------------------------------------------------- */'
  ].join('\n');

  server = server.replace('/* ---- Готовые краски ----------------------------------------------------- */', routes);
  fs.writeFileSync(serverFile, server);
  changed++;
  console.log('server.js: маршруты склада');
}

/* ---------------- Клиент ---------------- */
const appFile = path.join(root, 'server', 'public', 'app.js');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

if (!app.includes('renderWarehouse')) {
  const block = [
    '  /* ------------------------------------------------------------------------',
    '     Склад: видно всем, правит кладовщик',
    '     ------------------------------------------------------------------------ */',
    '',
    '  const canStore = () => state.user && (state.user.role === \'admin\' || state.user.role === \'store\');',
    '',
    '  async function loadWarehouse(term) {',
    "    const host = $('#warehouseList');",
    '    if (!host) return;',
    '',
    "    host.innerHTML = '<div class=\"spinner\">Загрузка…</div>';",
    '',
    '    try {',
    "      const query = term !== undefined ? term : ($('#warehouseSearch') ? $('#warehouseSearch').value.trim() : '');",
    "      const data = await api('/api/stock' + (query ? '?q=' + encodeURIComponent(query) : ''));",
    '',
    '      state.stock = data.items;',
    '      renderWarehouse();',
    '    } catch (error) {',
    '      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;',
    '    }',
    '  }',
    '',
    '  function renderWarehouse() {',
    "    const host = $('#warehouseList');",
    '    if (!host) return;',
    '',
    '    if (!state.stock.length) {',
    "      host.innerHTML = '<div class=\"empty-line\">Ничего не найдено</div>';",
    '      return;',
    '    }',
    '',
    '    host.innerHTML = `',
    '      <table class="grid">',
    '        <thead>',
    '          <tr><th>Код</th><th>Наименование</th><th class="num">Остаток</th><th class="num">Списано</th></tr>',
    '        </thead>',
    '        <tbody>',
    "          ${state.stock.map((item) => `",
    '            <tr>',
    '              <td class="code-cell" data-label="Код">${esc(item.code)}</td>',
    '              <td data-label="Наименование">${esc(item.name)}</td>',
    '              <td class="num" data-label="Остаток">',
    "                ${canStore()",
    '                  ? `<span class="stock-inline"><input type="number" min="0" step="0.01" value="${item.left}" data-stock-code="${esc(item.code)}" style="width:100px;text-align:right"> <span class="unit">${esc(item.unit)}</span></span>`',
    '                  : `<span class="stock-badge${item.left <= 0 ? \' empty\' : \'\'}">${qty(item.left)} ${esc(item.unit)}</span>`}',
    '              </td>',
    '              <td class="muted" data-label="Списано">${qty(item.used)} ${esc(item.unit)}</td>',
    '            </tr>`).join(\'\')}',
    '        </tbody>',
    '      </table>',
    '    `;',
    '',
    "    host.querySelectorAll('[data-stock-code]').forEach((input) => {",
    "      input.addEventListener('change', async () => {",
    '        try {',
    "          await api('/api/stock/' + encodeURIComponent(input.dataset.stockCode), {",
    "            method: 'PATCH',",
    '            body: { left: Number(input.value) || 0 }',
    '          });',
    '',
    "          toast('Остаток обновлён');",
    '          loadWarehouse();',
    '        } catch (error) {',
    '          toast(error.message);',
    '        }',
    '      });',
    '    });',
    '  }',
    '',
    '  async function addStockItem() {',
    "    const name = $('#stockName').value.trim();",
    "    const code = $('#stockCode').value.trim();",
    "    const unit = $('#stockUnit').value;",
    "    const category = $('#stockCategory').value;",
    "    const left = Number($('#stockLeft').value) || 0;",
    '',
    '    if (!name) {',
    "      toast('Введите наименование');",
    '      return;',
    '    }',
    '',
    '    try {',
    "      await api('/api/stock', { method: 'POST', body: { name, code, unit, category, stock: left } });",
    '',
    "      ['stockName', 'stockCode', 'stockLeft'].forEach((id) => { $('#' + id).value = ''; });",
    "      toast('Материал добавлен на склад');",
    '      loadWarehouse();',
    '    } catch (error) {',
    '      toast(error.message);',
    '    }',
    '  }',
    '',
    '  /* ------------------------------------------------------------------------',
    '     Готовые краски',
    '     ------------------------------------------------------------------------ */'
  ].join('\n');

  const anchor = '  /* ------------------------------------------------------------------------\n     Готовые краски';

  if (!app.includes('     Готовые краски')) {
    console.error('app.js: не нашёл блок готовых красок');
  } else {
    app = app.replace(/  \/\* -+\n     Готовые краски[\s\S]{0,40}?-+\n/, block + '\n');
    fs.writeFileSync(appFile, app);
    changed++;
    console.log('app.js: функции склада');
  }
}

console.log('изменений:', changed);
