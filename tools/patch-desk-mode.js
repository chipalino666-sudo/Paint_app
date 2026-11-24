'use strict';

/*
 * Режим «рабочий стол»: разделы открываются в окнах, которые можно
 * свернуть и закрыть. Классический интерфейс остаётся как есть,
 * переключение — в меню пользователя.
 *
 *   node tools/patch-desk-mode.js
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

/* ---------- 1. Переключатель в меню пользователя ---------- */

if (!html.includes('id="btnUiMode"')) {
  const anchor = '<button class="menu-item" id="navInstall">Установить приложение</button>';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл меню пользователя');
    process.exit(1);
  }

  html = html.replace(anchor, '<button class="menu-item" id="btnUiMode">Режим: обычный</button>\n    ' + anchor);
  changed++;
  console.log('index.html: пункт переключения режима');
}

/* ---------- 2. Слой окон и панель задач ---------- */

if (!html.includes('id="deskWindows"')) {
  const anchor = '  </main>';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл </main>');
    process.exit(1);
  }

  const layer = [
    '',
    '  <!-- Слой окон режима «рабочий стол» -->',
    '  <div class="desk-layer hidden" id="deskLayer">',
    '    <div class="desk-windows" id="deskWindows"></div>',
    '    <div class="desk-taskbar hidden" id="deskTaskbar"></div>',
    '  </div>',
    '',
    '  </main>'
  ].join('\n');

  html = html.replace(anchor, layer);
  changed++;
  console.log('index.html: слой окон');
}

fs.writeFileSync(htmlFile, html);

/* ---------- 3. Логика режима ---------- */

if (!app.includes('openDeskWindow')) {
  const anchor = 'async function openOrder(id) {';

  if (!app.includes(anchor)) {
    console.error('app.js: не нашёл openOrder');
    process.exit(1);
  }

  const block = [
    '/* --------------------------------------------------------------------------',
    '   Режим «рабочий стол»: разделы открываются окнами',
    '   -------------------------------------------------------------------------- */',
    '',
    "const UI_MODE_KEY = 'paintShopUiMode';",
    '',
    "const WINDOW_TITLES = {",
    "  orders: 'Заказы',",
    "  order: 'Заказ',",
    "  new: 'Новый заказ',",
    "  chat: 'Обсуждения',",
    "  report: 'Отчёт',",
    "  clients: 'Клиенты',",
    "  stock: 'Склад',",
    "  tds: 'ТДС и паспорта',",
    "  norms: 'Нормы списания',",
    "  refs: 'Справочники',",
    "  users: 'Сотрудники'",
    '};',
    '',
    'function uiMode() {',
    "  return localStorage.getItem(UI_MODE_KEY) === 'desk' ? 'desk' : 'classic';",
    '}',
    '',
    'function uiModeLabel() {',
    "  const button = $('#btnUiMode');",
    '  if (!button) return;',
    '',
    "  button.textContent = uiMode() === 'desk' ? 'Режим: рабочий стол' : 'Режим: обычный';",
    '}',
    '',
    '/** Включаем/выключаем режим и возвращаем все разделы на место. */',
    'function applyUiMode() {',
    "  const desk = uiMode() === 'desk';",
    '',
    "  document.body.classList.toggle('ui-desk', desk);",
    '',
    "  const layer = $('#deskLayer');",
    "  const taskbar = $('#deskTaskbar');",
    '',
    '  if (desk) {',
    "    if (layer) layer.classList.remove('hidden');",
    "    if (taskbar) taskbar.classList.remove('hidden');",
    '',
    "    showDeskHome();",
    '  } else {',
    '    closeAllWindows();',
    '',
    "    if (layer) layer.classList.add('hidden');",
    "    if (taskbar) taskbar.classList.add('hidden');",
    '',
    "    showView('orders');",
    '  }',
    '',
    '  uiModeLabel();',
    '}',
    '',
    'function toggleUiMode() {',
    "  localStorage.setItem(UI_MODE_KEY, uiMode() === 'desk' ? 'classic' : 'desk');",
    '  applyUiMode();',
    '}',
    '',
    '/** Стол как фон: показываем только домашнюю вьюху. */',
    'function showDeskHome() {',
    "  $$('.view').forEach((view) => view.classList.add('hidden'));",
    '',
    "  const home = $('#view-home');",
    "  if (home) home.classList.remove('hidden');",
    '',
    "  state.view = 'home';",
    "  if (typeof loadDesk === 'function') loadDesk();",
    '}',
    '',
    'function windowTitle(name) {',
    '  if (name === \'order\' && state.order) return `Заказ ${state.order.number}`;',
    "  return WINDOW_TITLES[name] || 'Раздел';",
    '}',
    '',
    '/** Открыть раздел в окне (или поднять уже открытое). */',
    'function openDeskWindow(name) {',
    "  const host = $('#deskWindows');",
    '  if (!host) return;',
    '',
    "  const view = document.getElementById('view-' + name);",
    '  if (!view) return;',
    '',
    "  let win = host.querySelector('[data-window=\"' + name + '\"]');",
    '',
    '  if (!win) {',
    "    win = document.createElement('div');",
    "    win.className = 'desk-window';",
    "    win.dataset.window = name;",
    '',
    '    win.innerHTML = `',
    '      <div class="desk-window-head">',
    '        <span class="desk-window-title"></span>',
    '        <span class="desk-window-btns">',
    '          <button class="desk-win-btn" data-win-min title="Свернуть">–</button>',
    '          <button class="desk-win-btn" data-win-close title="Закрыть">×</button>',
    '        </span>',
    '      </div>',
    '      <div class="desk-window-body"></div>',
    '    `;',
    '',
    '    const count = host.querySelectorAll(\'.desk-window\').length;',
    '    const offset = (count % 5) * 24;',
    '',
    "    win.style.left = Math.min(40 + offset, Math.max(10, window.innerWidth - 820)) + 'px';",
    "    win.style.top = Math.min(30 + offset, Math.max(10, window.innerHeight - 640)) + 'px';",
    '',
    "    win.querySelector('.desk-window-body').appendChild(view);",
    "    view.classList.remove('hidden');",
    '',
    "    win.querySelector('[data-win-close]').addEventListener('click', () => closeDeskWindow(name));",
    "    win.querySelector('[data-win-min]').addEventListener('click', () => minimizeDeskWindow(name));",
    '',
    "    win.querySelector('.desk-window-head').addEventListener('pointerdown', (event) => startWindowDrag(event, win));",
    '',
    '    host.appendChild(win);',
    '  } else {',
    "    win.querySelector('.desk-window-body').appendChild(view);",
    "    view.classList.remove('hidden');",
    "    win.classList.remove('minimized');",
    '  }',
    '',
    '  focusDeskWindow(name);',
    '  renderDeskTaskbar();',
    '',
    '  if (name === \'orders\') loadOrders();',
    '  if (name === \'chat\') openGeneralChat();',
    '  if (name === \'report\') loadReport();',
    '  if (name === \'refs\') loadRefs();',
    '  if (name === \'clients\') loadClients();',
    '  if (name === \'stock\') loadWarehouse();',
    '  if (name === \'tds\') loadTdsView();',
    '  if (name === \'norms\') loadNormsView();',
    '  if (name === \'users\') loadUsers();',
    '}',
    '',
    'let windowZ = 100;',
    '',
    'function focusDeskWindow(name) {',
    "  const host = $('#deskWindows');",
    '  if (!host) return;',
    '',
    "  const win = host.querySelector('[data-window=\"' + name + '\"]');",
    '  if (!win) return;',
    '',
    '  windowZ += 1;',
    '  win.style.zIndex = String(windowZ);',
    '  win.classList.remove(\'minimized\');',
    '',
    "  host.querySelectorAll('.desk-window').forEach((item) => item.classList.remove('active'));",
    "  win.classList.add('active');",
    '',
    '  renderDeskTaskbar();',
    '}',
    '',
    'function minimizeDeskWindow(name) {',
    "  const host = $('#deskWindows');",
    '  if (!host) return;',
    '',
    "  const win = host.querySelector('[data-window=\"' + name + '\"]');",
    "  if (win) win.classList.add('minimized');",
    '',
    '  renderDeskTaskbar();',
    '}',
    '',
    '/** Вернуть раздел в общий контейнер — как в обычном режиме. */',
    'function detachWindowView(name) {',
    "  const view = document.getElementById('view-' + name);",
    "  const main = document.querySelector('main.main') || $('.main');",
    '',
    '  if (view && main && view.parentElement && !main.contains(view)) {',
    '    main.appendChild(view);',
    "    view.classList.add('hidden');",
    '  }',
    '}',
    '',
    'function closeDeskWindow(name) {',
    "  const host = $('#deskWindows');",
    '  if (!host) return;',
    '',
    "  const win = host.querySelector('[data-window=\"' + name + '\"]');",
    '',
    '  detachWindowView(name);',
    '',
    '  if (win) win.remove();',
    '',
    '  renderDeskTaskbar();',
    '',
    '  // Заказы закрываем вместе с карточкой заказа',
    "  if (name === 'orders') closeDeskWindow('order');",
    '}',
    '',
    'function closeAllWindows() {',
    "  const host = $('#deskWindows');",
    '  if (!host) return;',
    '',
    "  host.querySelectorAll('.desk-window').forEach((win) => {",
    '    detachWindowView(win.dataset.window);',
    '    win.remove();',
    '  });',
    '',
    '  renderDeskTaskbar();',
    '}',
    '',
    'function renderDeskTaskbar() {',
    "  const bar = $('#deskTaskbar');",
    '  if (!bar) return;',
    '',
    "  const host = $('#deskWindows');",
    "  const wins = host ? [...host.querySelectorAll('.desk-window')] : [];",
    '',
    '  if (!wins.length) {',
    "    bar.innerHTML = '<span class=\"desk-taskbar-hint\">Открывайте разделы с рабочего стола</span>';",
    '    return;',
    '  }',
    '',
    '  bar.innerHTML = wins.map((win) => {',
    '    const name = win.dataset.window;',
    '    const active = win.classList.contains(\'active\') && !win.classList.contains(\'minimized\');',
    '',
    '    return `<button class="desk-task ${active ? \'active\' : \'\'}" data-task="${esc(name)}">${esc(windowTitle(name))}</button>`;',
    '  }).join(\'\');',
    '',
    '  bar.querySelectorAll(\'[data-task]\').forEach((button) => {',
    '    button.addEventListener(\'click\', () => {',
    '      const name = button.dataset.task;',
    "      const win = host.querySelector('[data-window=\"' + name + '\"]');",
    '',
    '      if (!win) return;',
    '',
    '      if (win.classList.contains(\'active\') && !win.classList.contains(\'minimized\')) {',
    '        minimizeDeskWindow(name);',
    '      } else {',
    '        focusDeskWindow(name);',
    '      }',
    '    });',
    '  });',
    '}',
    '',
    '/** Перетаскивание окна за заголовок. */',
    'function startWindowDrag(event, win) {',
    '  if (event.target.closest(\'button\')) return;',
    '',
    '  const startX = event.clientX;',
    '  const startY = event.clientY;',
    '  const left = parseFloat(win.style.left || \'0\');',
    '  const top = parseFloat(win.style.top || \'0\');',
    '',
    '  const move = (e) => {',
    '    win.style.left = Math.max(0, left + e.clientX - startX) + \'px\';',
    '    win.style.top = Math.max(0, top + e.clientY - startY) + \'px\';',
    '  };',
    '',
    '  const up = () => {',
    "    document.removeEventListener('pointermove', move);",
    "    document.removeEventListener('pointerup', up);",
    '  };',
    '',
    "  document.addEventListener('pointermove', move);",
    "  document.addEventListener('pointerup', up);",
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, block);
  changed++;
  console.log('app.js: логика окон');
}

/* ---------- 4. showView перенаправляет в окна ---------- */

if (!app.includes('openDeskWindow(name)')) {
  app = app.replace(
    '    function showView(name) {\n      if (name === \'home\' && typeof loadDesk === \'function\') loadDesk();',
    [
      '    function showView(name) {',
      '      // В режиме рабочего стола разделы открываются окнами',
      "      if (typeof uiMode === 'function' && uiMode() === 'desk') {",
      "        if (name === 'home') { showDeskHome(); return; }",
      '',
      '        openDeskWindow(name);',
      '        return;',
      '      }',
      '',
      "      if (name === 'home' && typeof loadDesk === 'function') loadDesk();"
    ].join('\n')
  );
  changed++;
  console.log('app.js: showView в режиме стола');
}

/* ---------- 5. Заголовок окна заказа ---------- */

if (!app.includes('refreshWindowTitles')) {
  app = app.replace(
    '      showView(\'order\');',
    '      showView(\'order\');\n      refreshWindowTitles();'
  );

  const anchor = 'function renderDeskTaskbar() {';
  app = app.replace(anchor, [
    'function refreshWindowTitles() {',
    "  const host = $('#deskWindows');",
    '  if (!host) return;',
    '',
    "  host.querySelectorAll('.desk-window').forEach((win) => {",
    "    const title = win.querySelector('.desk-window-title');",
    '    if (title) title.textContent = windowTitle(win.dataset.window);',
    '  });',
    '',
    '  renderDeskTaskbar();',
    '}',
    '',
    anchor
  ].join('\n'));

  changed++;
  console.log('app.js: заголовки окон');
}

/* ---------- 6. Пуск: применяем режим и вешаем переключатель ---------- */

if (!app.includes('toggleUiMode()')) {
  app = app.replace(
    "    showView('home');\n      loadDesk();",
    "    applyUiMode();"
  );

  app = app.replace(
    "    if ($('#btnPassword')) $('#btnPassword').addEventListener('click', openPasswordModal);",
    [
      "    if ($('#btnPassword')) $('#btnPassword').addEventListener('click', openPasswordModal);",
      '',
      "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);"
    ].join('\n')
  );

  changed++;
  console.log('app.js: пуск и переключатель');
}

fs.writeFileSync(appFile, app);

/* ---------- 7. Стили ---------- */

if (!css.includes('.desk-window')) {
  css += `

/* ---------- Режим «рабочий стол» ----------------------------------------- */

body.ui-desk .main { padding-bottom: 84px; }

.desk-layer { position: fixed; inset: 0; z-index: 60; pointer-events: none; }
.desk-layer.hidden { display: none; }

.desk-windows { position: absolute; inset: 0; pointer-events: none; }

.desk-window {
  position: absolute;
  width: min(880px, 96vw);
  height: min(620px, calc(100vh - 160px));
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, .45);
  overflow: hidden;
  resize: both;
}

.desk-window.minimized { display: none; }

.desk-window-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
}

.desk-window-title { font-size: 13px; font-weight: 700; }

.desk-window-btns { display: flex; gap: 4px; }

.desk-win-btn {
  width: 26px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--ink-soft);
  font-family: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.desk-win-btn:hover { color: var(--ink); border-color: var(--blue); }

.desk-window-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 14px;
}

.desk-window-body .view { padding: 0; }

.desk-taskbar {
  position: fixed;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 32px);
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow-md);
  pointer-events: auto;
}

.desk-task {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  color: var(--ink-soft);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.desk-task.active { background: var(--blue); border-color: var(--blue); color: #fff; }

.desk-taskbar-hint { font-size: 12px; color: var(--ink-soft); padding: 2px 6px; }

@media (max-width: 780px) {
  .desk-window {
    width: calc(100vw - 12px);
    height: calc(100vh - 150px);
    left: 6px !important;
    top: 64px !important;
  }

  .desk-taskbar { bottom: 8px; gap: 6px; padding: 6px 8px; }
  .desk-task { padding: 6px 10px; font-size: 12px; }
}
`;
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: стили окон');
}

console.log('изменений:', changed);
