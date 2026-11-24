'use strict';

/*
 * Быстрый прототип «рабочего стола» и вкладок заказов.
 *
 * 1. новая вьюха #view-home с плитками и поиском
 * 2. кнопка «Стол» в навигации
 * 3. вкладки открытых заказов над карточкой
 *
 *   node tools/patch-desktop.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const htmlFile = path.join(root, 'server', 'public', 'index.html');
const appFile = path.join(root, 'server', 'public', 'app.js');
const cssFile = path.join(root, 'server', 'public', 'extra.css');

let html = fs.readFileSync(htmlFile, 'utf8').replace(/\r\n/g, '\n');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

let changed = 0;

/* ---------- 1. Кнопка «Стол» в навигации ---------- */

if (!html.includes('data-view="home"')) {
  const anchor = '<button class="nav-btn active" data-view="orders">Заказы';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл кнопку Заказы');
    process.exit(1);
  }

  html = html.replace(anchor, '<button class="nav-btn active" data-view="home">Стол</button>\n      <button class="nav-btn" data-view="orders">Заказы');
  changed++;
  console.log('index.html: кнопка «Стол»');
}

/* ---------- 2. Вьюха рабочего стола ---------- */

if (!html.includes('id="view-home"')) {
  const anchor = '  <!-- ======================= СПИСОК ЗАКАЗОВ ======================= -->';

  const block = [
    '    <!-- ======================= РАБОЧИЙ СТОЛ ======================= -->',
    '    <section class="view" id="view-home">',
    '      <div class="desk-head">',
    '        <h1 class="desk-title" id="deskHello">Рабочий стол</h1>',
    '        <div class="desk-clock" id="deskClock"></div>',
    '      </div>',
    '',
    '      <div class="desk-search-wrap">',
    '        <input type="search" id="deskSearch" data-noshield="1" placeholder="Найти: номер заказа, госномер, модель, материал…" autocomplete="off">',
    '        <div class="desk-search-results hidden" id="deskSearchResults"></div>',
    '      </div>',
    '',
    '      <div class="desk-grid" id="deskGrid"></div>',
    '    </section>',
    '',
    anchor
  ].join('\n');

  html = html.replace(anchor, block);
  changed++;
  console.log('index.html: вьюха рабочего стола');
}

/* ---------- 3. Полоса вкладок заказов ---------- */

if (!html.includes('id="orderTabs"')) {
  const anchor = '    <section class="view hidden" id="view-order">\n      <div id="orderBody"></div>';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл view-order');
    process.exit(1);
  }

  html = html.replace(anchor, [
    '    <section class="view hidden" id="view-order">',
    '      <div class="order-tabs-bar hidden" id="orderTabs"></div>',
    '      <div id="orderBody"></div>'
  ].join('\n'));
  changed++;
  console.log('index.html: полоса вкладок');
}

fs.writeFileSync(htmlFile, html);

/* ---------- 4. Логика ---------- */

if (!app.includes('renderDesk')) {
  const anchor = '  function openOrder(id) {';

  if (!app.includes(anchor)) {
    console.error('app.js: не нашёл openOrder');
    process.exit(1);
  }

  const block = [
    '  /* --------------------------------------------------------------------',
    '     Рабочий стол: плитки и поиск',
    '     -------------------------------------------------------------------- */',
    '',
    '  let deskTimer = null;',
    '',
    '  function deskTile(options) {',
    '    return `<button class="desk-tile ${options.cls || \'\'}" data-desk="${esc(options.desk || \'\')}">',
    '      <span class="desk-tile-icon">${options.icon || \'\'}</span>',
    '      <span class="desk-tile-title">${esc(options.title)}</span>',
    '      ${options.count !== null && options.count !== undefined',
    '        ? `<span class="desk-tile-count">${esc(String(options.count))}</span>`',
    '        : \'\'}',
    '      ${options.note ? `<span class="desk-tile-note">${esc(options.note)}</span>` : \'\'}',
    '    </button>`;',
    '  }',
    '',
    '  async function loadDesk() {',
    '    const grid = $(\'#deskGrid\');',
    '    if (!grid) return;',
    '',
    '    const user = state.user || {};',
    '    const hello = $(\'#deskHello\');',
    '',
    '    if (hello) {',
    '      const hour = new Date().getHours();',
    '      const part = hour < 6 ? \'Доброй ночи\' : hour < 12 ? \'Доброе утро\' : hour < 18 ? \'Добрый день\' : \'Добрый вечер\';',
    '      hello.textContent = `${part}, ${String(user.full_name || \'\').split(\' \')[0] || \'коллега\'}`;',
    '    }',
    '',
    '    const clock = $(\'#deskClock\');',
    '    if (clock) {',
    '      const now = new Date();',
    '      clock.textContent = now.toLocaleDateString(\'ru-RU\', { day: \'2-digit\', month: \'long\' })',
    '        + \', \' + now.toLocaleTimeString(\'ru-RU\', { hour: \'2-digit\', minute: \'2-digit\' });',
    '    }',
    '',
    '    grid.innerHTML = \'<div class="muted" style="padding:10px">Собираю…</div>\';',
    '',
    '    let orders = [];',
    '    let lowStock = 0;',
    '    let docs = 0;',
    '',
    '    try {',
    '      orders = (await api(\'/api/orders\')).orders || [];',
    '    } catch (error) { /* без заказов */ }',
    '',
    '    try {',
    '      const low = await api(\'/api/stock/low\');',
    '      lowStock = (low.items || []).length;',
    '    } catch (error) { /* нет доступа */ }',
    '',
    '    try {',
    '      const tds = await api(\'/api/tds\');',
    '      docs = (tds.docs || []).length;',
    '    } catch (error) { /* нет доступа */ }',
    '',
    '    const count = (status) => orders.filter((row) => row.status === status).length;',
    '    const open = orders.filter((row) => row.status === \'accepted\' || row.status === \'in_work\').length;',
    '',
    '    const tiles = [',
    '      deskTile({ title: \'Заказы\', count: open, note: \'в работе и приняты\', icon: \'📋\', desk: \'orders\' }),',
    '      deskTile({ title: \'Приняты\', count: count(\'accepted\'), note: \'ждут мастера\', icon: \'🕓\', desk: \'accepted\' }),',
    '      deskTile({ title: \'В работе\', count: count(\'in_work\'), note: \'красятся\', icon: \'🔧\', desk: \'in_work\' }),',
    '      deskTile({ title: \'Готовы\', count: count(\'ready\'), note: \'к выдаче\', icon: \'✅\', desk: \'ready\' }),',
    '      deskTile({ title: \'Пора заказать\', count: lowStock, note: \'склад на минимуме\', icon: \'🛒\', desk: \'stock\' }),',
    '      deskTile({ title: \'ТДС и паспорта\', count: docs, note: \'документов\', icon: \'📄\', desk: \'tds\' }),',
    '      deskTile({ title: \'Нормы списания\', note: \'что списывается\', icon: \'⚖️\', desk: \'norms\' }),',
    '      deskTile({ title: \'Справочники\', note: \'краски, материалы\', icon: \'📚\', desk: \'refs\' }),',
    '      deskTile({ title: \'Помощник\', note: \'спросите голосом\', icon: \'🤖\', desk: \'ai\' }),',
    '      deskTile({ title: \'Новый заказ\', note: \'машина приехала\', icon: \'➕\', desk: \'new\' })',
    '    ];',
    '',
    '    grid.innerHTML = tiles.join(\'\');',
    '',
    '    grid.querySelectorAll(\'[data-desk]\').forEach((button) => {',
    '      button.addEventListener(\'click\', () => {',
    '        const target = button.dataset.desk;',
    '',
    '        if (target === \'ai\') { aiOpen(); return; }',
    '        if (target === \'new\') { showView(\'new\'); return; }',
    '        if (target === \'orders\') { state.orderFilter.status = \'\'; showView(\'orders\'); loadOrders(); return; }',
    '        if (target === \'stock\') { showView(\'stock\'); return; }',
    '        if (target === \'tds\') { showView(\'tds\'); return; }',
    '        if (target === \'norms\') { showView(\'norms\'); return; }',
    '        if (target === \'refs\') { showView(\'refs\'); return; }',
    '',
    '        state.orderFilter.status = target;',
    '        showView(\'orders\');',
    '        renderStatusChips();',
    '        loadOrders();',
    '      });',
    '    });',
    '  }',
    '',
    '  /** Быстрый поиск с рабочего стола: заказы и материалы. */',
    '  async function deskSearchRun(term) {',
    '    const panel = $(\'#deskSearchResults\');',
    '    if (!panel) return;',
    '',
    '    const q = String(term || \'\').trim();',
    '',
    '    if (q.length < 2) {',
    '      panel.classList.add(\'hidden\');',
    '      return;',
    '    }',
    '',
    '    try {',
    '      const [foundOrders, foundMaterials] = await Promise.all([',
    '        api(\'/api/orders?q=\' + encodeURIComponent(q)).catch(() => ({ orders: [] })),',
    '        api(\'/api/materials?q=\' + encodeURIComponent(q)).catch(() => ({ materials: [] }))',
    '      ]);',
    '',
    '      const orders = (foundOrders.orders || []).slice(0, 5);',
    '      const materials = (foundMaterials.materials || []).slice(0, 5);',
    '',
    '      if (!orders.length && !materials.length) {',
    '        panel.innerHTML = \'<div class="row" style="cursor:default">Ничего не найдено</div>\';',
    '        panel.classList.remove(\'hidden\');',
    '        return;',
    '      }',
    '',
    '      panel.innerHTML = [',
    '        orders.map((order) => `',
    '          <div class="row desk-hit" data-desk-order="${esc(order.id)}">',
    '            <span class="code">${esc(order.number)}</span>',
    '            <span class="name">${esc(order.plate)} · ${esc([order.make, order.model].filter(Boolean).join(\' \'))}</span>',
    '          </div>`).join(\'\'),',
    '        materials.map((item) => `',
    '          <div class="row desk-hit" data-desk-material="${esc(item.code)}">',
    '            <span class="code">${esc(item.code)}</span>',
    '            <span class="name">${esc(item.name)} · ${qty(item.stock_left || 0)} ${esc(item.unit)}</span>',
    '          </div>`).join(\'\')',
    '      ].join(\'\');',
    '',
    '      panel.classList.remove(\'hidden\');',
    '',
    '      panel.querySelectorAll(\'[data-desk-order]\').forEach((row) => {',
    '        row.addEventListener(\'click\', () => {',
    '          panel.classList.add(\'hidden\');',
    '          openOrder(row.dataset.deskOrder);',
    '        });',
    '      });',
    '',
    '      panel.querySelectorAll(\'[data-desk-material]\').forEach((row) => {',
    '        row.addEventListener(\'click\', () => {',
    '          panel.classList.add(\'hidden\');',
    '          showView(\'stock\');',
    '        });',
    '      });',
    '    } catch (error) {',
    '      panel.classList.add(\'hidden\');',
    '    }',
    '  }',
    '',
    '  /* --------------------------------------------------------------------',
    '     Вкладки открытых заказов',
    '     -------------------------------------------------------------------- */',
    '',
    '  function renderOrderTabs() {',
    '    const bar = $(\'#orderTabs\');',
    '    if (!bar) return;',
    '',
    '    const list = state.openOrders || [];',
    '',
    '    if (!list.length) {',
    '      bar.classList.add(\'hidden\');',
    '      bar.innerHTML = \'\';',
    '      return;',
    '    }',
    '',
    '    bar.classList.remove(\'hidden\');',
    '',
    '    bar.innerHTML = list.map((item) => `',
    '      <button class="order-tab-chip ${Number(item.id) === Number(state.order && state.order.id) ? \'active\' : \'\'}" data-order-tab="${esc(item.id)}">',
    '        <span>${esc(item.number)}</span>',
    '        <span class="order-tab-plate">${esc(item.plate)}</span>',
    '        <span class="order-tab-x" data-order-tab-close="${esc(item.id)}">×</span>',
    '      </button>`).join(\'\');',
    '',
    '    bar.querySelectorAll(\'[data-order-tab]\').forEach((button) => {',
    '      button.addEventListener(\'click\', (event) => {',
    '        if (event.target.dataset.orderTabClose) return;',
    '        openOrder(button.dataset.orderTab);',
    '      });',
    '    });',
    '',
    '    bar.querySelectorAll(\'[data-order-tab-close]\').forEach((button) => {',
    '      button.addEventListener(\'click\', (event) => {',
    '        event.stopPropagation();',
    '',
    '        const id = button.dataset.orderTabClose;',
    '        state.openOrders = (state.openOrders || []).filter((item) => String(item.id) !== String(id));',
    '',
    '        if (state.order && String(state.order.id) === String(id)) {',
    '          const next = (state.openOrders || [])[0];',
    '          if (next) openOrder(next.id); else showView(\'orders\');',
    '        } else {',
    '          renderOrderTabs();',
    '        }',
    '      });',
    '    });',
    '  }',
    '',
    '  function rememberOrder(order) {',
    '    if (!order || !order.id) return;',
    '',
    '    state.openOrders = state.openOrders || [];',
    '',
    '    if (!state.openOrders.some((item) => String(item.id) === String(order.id))) {',
    '      state.openOrders.push({ id: order.id, number: order.number, plate: order.plate });',
    '    }',
    '',
    '    // Больше пяти вкладок не держим',
    '    while (state.openOrders.length > 5) state.openOrders.shift();',
    '  }',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, block);
  changed++;
  console.log('app.js: рабочий стол и вкладки');
}

/* ---------- 5. Вспоминаем открытый заказ и показываем вкладки ---------- */

if (!app.includes('rememberOrder(order)')) {
  console.log('app.js: openOrder нужно доработать вручную');
} else if (!app.includes('renderOrderTabs();\n\n    renderOrder();')) {
  // после загрузки заказа добавляем вкладку
  app = app.replace(
    '    state.order = data.order;',
    '    state.order = data.order;\n    rememberOrder(data.order);\n    renderOrderTabs();'
  );
  changed++;
  console.log('app.js: openOrder запоминает заказ');
}

/* ---------- 6. Стартовый экран ---------- */

if (!app.includes("showView('home')")) {
  app = app.replace(
    "    showView('orders');\n    loadOrders();",
    "    showView('home');\n    loadOrders();"
  );
  changed++;
  console.log('app.js: стартуем с рабочего стола');
}

fs.writeFileSync(appFile, app);

/* ---------- 7. Стили ---------- */

if (!css.includes('.desk-grid')) {
  css += `

/* ---------- Рабочий стол -------------------------------------------------- */

.desk-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.desk-title { font-size: 22px; margin: 0; }
.desk-clock { font-size: 13px; color: var(--ink-soft); white-space: nowrap; }

.desk-search-wrap { position: relative; margin-bottom: 16px; }

.desk-search-wrap input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: 14px;
}

.desk-search-results {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  z-index: 60;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.desk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.desk-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px;
  min-height: 96px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, transform .15s;
}

.desk-tile:hover { border-color: var(--blue); transform: translateY(-1px); }
.desk-tile-icon { font-size: 20px; }
.desk-tile-title { font-size: 13.5px; font-weight: 700; }
.desk-tile-note { font-size: 11.5px; color: var(--ink-soft); }

.desk-tile-count {
  position: absolute;
  top: 10px;
  right: 12px;
  min-width: 24px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--blue);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

/* ---------- Вкладки заказов ---------------------------------------------- */

.order-tabs-bar {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 8px;
  margin-bottom: 10px;
  scrollbar-width: none;
}

.order-tabs-bar::-webkit-scrollbar { display: none; }

.order-tab-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink-soft);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.order-tab-chip.active {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
}

.order-tab-plate { font-weight: 400; opacity: .75; }

.order-tab-x {
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
  opacity: .7;
}

.order-tab-x:hover { opacity: 1; }

@media (max-width: 780px) {
  .desk-grid { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .desk-tile { min-height: 88px; padding: 12px; }
  .desk-tile-title { font-size: 12.5px; }
  .desk-title { font-size: 19px; }
}
`;
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: стили рабочего стола');
}

console.log('изменений:', changed);
