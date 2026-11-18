'use strict';

/*
 * Рабочий стол как сетка приложений + док слева + переключение окон.
 *
 *  1. показываем только активное окно (исправление переключения);
 *  2. закрытие окна не трогает остальные;
 *  3. сетка иконок с подписями и левый док.
 *
 *   node tools/patch-desk-grid.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');
const htmlFile = path.join(root, 'server', 'public', 'index.html');
const cssFile = path.join(root, 'server', 'public', 'extra.css');

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let app = read(appFile);
let html = read(htmlFile);
let css = read(cssFile);
let changed = 0;

/* ---------- 1. Только активное окно ---------- */

const oldFocus = [
  '  windowZ += 1;',
  '  win.style.zIndex = String(windowZ);',
  "  win.classList.remove('minimized');",
  '',
  "  host.querySelectorAll('.desk-window').forEach((item) => item.classList.remove('active'));",
  "  win.classList.add('active');"
].join('\n');

const newFocus = [
  '  windowZ += 1;',
  '  win.style.zIndex = String(windowZ);',
  '',
  '  // Окна занимают всю область: показываем только активное',
  "  host.querySelectorAll('.desk-window').forEach((item) => {",
  "    item.classList.remove('active');",
  "    item.classList.toggle('minimized', item !== win);",
  '  });',
  '',
  "  win.classList.remove('minimized');",
  "  win.classList.add('active');"
].join('\n');

if (app.includes(oldFocus)) {
  app = app.replace(oldFocus, newFocus);
  changed++;
  console.log('переключение: показываем только активное окно');
} else {
  console.log('переключение: блок не найден (возможно, уже поправлено)');
}

/* ---------- 2. Закрытие одного окна не закрывает другие ---------- */

const cascade = [
  '',
  '  // Закрыли заказы — закрываем и карточку заказа',
  "  if (name === 'orders') closeDeskWindow('order');"
].join('\n');

if (app.includes(cascade)) {
  app = app.replace(cascade, '');
  changed++;
  console.log('закрытие: убрана связка заказов и карточки');
}

/* ---------- 3. Разметка: док слева ---------- */

if (!html.includes('id="deskDock"')) {
  const anchor = '    <div class="desk-grid" id="deskGrid"></div>';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл сетку стола');
    process.exit(1);
  }

  html = html.replace(anchor, [
    '    <div class="desk-body">',
    '      <aside class="desk-dock" id="deskDock"></aside>',
    '',
    '      <div class="desk-main">',
    '        <div class="desk-grid" id="deskGrid"></div>',
    '      </div>',
    '    </div>'
  ].join('\n'));

  // поиск переносим внутрь основной колонки
  html = html.replace(
    '    <div class="desk-search-wrap">',
    '    <div class="desk-main-top"><div class="desk-search-wrap">'
  );
  html = html.replace(
    '    <div class="desk-body">',
    '    </div>\n\n    <div class="desk-body">'
  );

  changed++;
  console.log('index.html: док и колонки стола');
}

fs.writeFileSync(htmlFile, html);

/* ---------- 4. Рендер дока и плиток ---------- */

if (!app.includes('DESK_DOCK')) {
  const anchor = 'function deskTile(options) {';

  if (!app.includes(anchor)) {
    console.error('app.js: не нашёл deskTile');
    process.exit(1);
  }

  const block = [
    '/* Закреплённые разделы слева — как док в системе */',
    'const DESK_DOCK = [',
    "  { name: 'orders', icon: '📋', title: 'Заказы' },",
    "  { name: 'stock', icon: '📦', title: 'Склад' },",
    "  { name: 'tds', icon: '📄', title: 'ТДС' },",
    "  { name: 'norms', icon: '⚖️', title: 'Нормы' },",
    "  { name: 'refs', icon: '📚', title: 'Справочники' },",
    "  { name: 'chat', icon: '💬', title: 'Обсуждения' }",
    '];',
    '',
    'function renderDeskDock() {',
    "  const dock = $('#deskDock');",
    '  if (!dock) return;',
    '',
    "  const host = $('#deskWindows');",
    '',
    '  dock.innerHTML = DESK_DOCK.map((item) => {',
    "    const open = host && host.querySelector('[data-window=\"' + item.name + '\"]');",
    '',
    '    return `<button class="dock-btn ${open ? \'is-open\' : \'\'}" data-dock="${esc(item.name)}" title="${esc(item.title)}">',
    '      <span class="dock-icon">${item.icon}</span>',
    '      ${open ? \'<span class="dock-dot"></span>\' : \'\'}',
    '    </button>`;',
    "  }).join('') + `",
    '    <span class="dock-sep"></span>',
    '    <button class="dock-btn" data-dock="new" title="Новый заказ">➕</button>',
    '    <button class="dock-btn" data-dock="ai" title="Помощник">🤖</button>',
    '    <button class="dock-btn" data-dock="desk" title="Свернуть всё">🗗</button>',
    '  `;',
    '',
    "  dock.querySelectorAll('[data-dock]').forEach((button) => {",
    "    button.addEventListener('click', () => {",
    '      const target = button.dataset.dock;',
    '',
    "      if (target === 'ai') { aiOpen(); return; }",
    "      if (target === 'new') { showView('new'); return; }",
    '',
    "      if (target === 'desk') {",
    "        const list = $$('#deskWindows .desk-window');",
    "        list.forEach((win) => minimizeDeskWindow(win.dataset.window));",
    '        return;',
    '      }',
    '',
    '      showView(target);',
    '    });',
    '  });',
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block);
  changed++;
  console.log('app.js: док и его кнопки');
}

/* ---------- 5. Док обновляется вместе со столом и окнами ---------- */

if (!app.includes('renderDeskDock();')) {
  // после отрисовки плиток
  const gridEnd = [
    "  grid.querySelectorAll('[data-desk]').forEach((button) => {"
  ].join('\n');

  app = app.replace(
    '  grid.innerHTML = [',
    '  renderDeskDock();\n\n  grid.innerHTML = ['
  );

  // в панели задач — обновляем и док
  app = app.replace(
    'function renderDeskTaskbar() {',
    'function renderDeskTaskbar() {\n  renderDeskDock();\n'
  );

  changed++;
  console.log('app.js: обновление дока');
}

fs.writeFileSync(appFile, app);

/* ---------- 6. Стили: сетка приложений, док ---------- */

if (!css.includes('.desk-dock')) {
  css += `

/* ---------- Стол как сетка приложений ------------------------------------- */

.desk-body {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.desk-main { min-width: 0; }

.desk-search-wrap { margin-bottom: 18px; }

.desk-dock {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 6px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-sm);
}

.dock-btn {
  position: relative;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  font-family: inherit;
  font-size: 20px;
  cursor: pointer;
  transition: background .15s, border-color .15s, transform .15s;
}

.dock-btn:hover {
  background: var(--surface-2);
  border-color: var(--border);
  transform: translateY(-1px);
}

.dock-btn.is-open { background: color-mix(in srgb, var(--blue) 16%, transparent); }

.dock-dot {
  position: absolute;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--blue);
}

.dock-sep {
  width: 22px;
  height: 1px;
  background: var(--border);
  margin: 2px 0;
}

/* Плитки — как в сетке приложений: иконка сверху, подпись снизу */
.desk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
  gap: 4px;
}

.desk-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 12px 8px 10px;
  min-height: 0;
  border: none;
  border-radius: 14px;
  background: transparent;
  box-shadow: none;
  text-align: center;
}

.desk-tile:hover {
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  box-shadow: none;
  transform: none;
}

.desk-tile-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin: 0;
  border-radius: 15px;
  background: linear-gradient(160deg, rgba(96, 165, 250, .32), rgba(168, 85, 247, .26));
  border: 1px solid rgba(148, 163, 184, .22);
  font-size: 27px;
  line-height: 1;
}

.desk-tile-title {
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--ink);
  max-width: 108px;
}

.desk-tile-note { display: none; }

.desk-tile-count {
  position: absolute;
  top: 8px;
  right: calc(50% - 40px);
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: linear-gradient(180deg, #5b9bff, var(--blue));
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}

@media (max-width: 780px) {
  .desk-body { grid-template-columns: 1fr; }
  .desk-dock {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    padding: 8px;
  }
  .dock-sep { width: 1px; height: 22px; margin: 0 2px; }
  .desk-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); }
  .desk-tile-icon { width: 48px; height: 48px; font-size: 23px; }
  .desk-tile-title { font-size: 11.5px; }
}
`;
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: сетка приложений и док');
}

console.log('изменений:', changed);
