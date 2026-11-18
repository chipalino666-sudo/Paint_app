'use strict';

/*
 * Логика окон: раздел живёт в своём окне, навигация внутри окна
 * не открывает новые окна. Кнопка «Стол» сворачивает всё.
 *
 *   node tools/patch-desk-nav.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');
const htmlFile = path.join(root, 'server', 'public', 'index.html');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
let html = fs.readFileSync(htmlFile, 'utf8').replace(/\r\n/g, '\n');

let changed = 0;

/* ---------- 1. Убираем плашки открытых заказов ---------- */

const tabsMarkup = '      <div class="order-tabs-bar hidden" id="orderTabs"></div>\n';

if (html.includes(tabsMarkup)) {
  html = html.replace(tabsMarkup, '');
  changed++;
  console.log('index.html: плашки заказов убраны');
}

fs.writeFileSync(htmlFile, html);

const tabCall = [
  '      rememberOrder(data.order);',
  '      renderOrderTabs();'
].join('\n');

if (app.includes(tabCall)) {
  app = app.replace(tabCall, '');
  changed++;
  console.log('app.js: плашки больше не рисуются');
}

/* ---------- 2. Переход внутри активного окна ---------- */

const oldRedirect = [
  "      if (typeof uiMode === 'function' && uiMode() === 'desk') {",
  "        if (name === 'home') { showDeskHome(); return; }",
  '',
  '        openDeskWindow(name);',
  '        return;',
  '      }'
].join('\n');

const newRedirect = [
  "      if (typeof uiMode === 'function' && uiMode() === 'desk') {",
  "        if (name === 'home') { minimizeAllDeskWindows(); return; }",
  '',
  '        deskNavigate(name);',
  '        return;',
  '      }'
].join('\n');

if (app.includes(oldRedirect)) {
  app = app.replace(oldRedirect, newRedirect);
  changed++;
  console.log('showView: внутри окна, а не новым окном');
}

/* ---------- 3. showDeskHome не трогает содержимое окон ---------- */

const oldHome = [
  'function showDeskHome() {',
  "  $$('.view').forEach((view) => view.classList.add('hidden'));",
  '',
  "  const home = $('#view-home');",
  "  if (home) home.classList.remove('hidden');",
  '',
  "  state.view = 'home';",
  "  if (typeof loadDesk === 'function') loadDesk();",
  '}'
].join('\n');

const newHome = [
  'function showDeskHome() {',
  '  const main = document.querySelector(\'main.main\');',
  '',
  '  // Скрываем только то, что лежит на странице, — содержимое окон не трогаем',
  "  $$('.view').forEach((view) => {",
  '    if (main && view.parentElement === main) view.classList.add(\'hidden\');',
  '  });',
  '',
  "  const home = $('#view-home');",
  "  if (home) home.classList.remove('hidden');",
  '',
  "  state.view = 'home';",
  "  if (typeof loadDesk === 'function') loadDesk();",
  '}'
].join('\n');

if (app.includes(oldHome)) {
  app = app.replace(oldHome, newHome);
  changed++;
  console.log('showDeskHome: не прячет окна');
}

/* ---------- 4. Новые функции: навигация внутри окна ---------- */

if (!app.includes('function deskNavigate')) {
  const anchor = 'function focusDeskWindow(name) {';

  const block = [
    '/** Какое окно сейчас активно. */',
    'function activeDeskWindow() {',
    "  const host = $('#deskWindows');",
    '  if (!host) return null;',
    '',
    "  return host.querySelector('.desk-window.active') || null;",
    '}',
    '',
    '/** Вернуть раздел на страницу, если он лежит в каком-то окне. */',
    'function detachViewFromWindows(view) {',
    '  if (!view) return;',
    '',
    '  const main = document.querySelector(\'main.main\');',
    '  if (!main) return;',
    '',
    '  if (view.parentElement && view.parentElement !== main) {',
    '    main.appendChild(view);',
    "    view.classList.add('hidden');",
    '  }',
    '}',
    '',
    '/**',
    ' * Переход внутри активного окна: заказ, карточка, ТДС — всё остаётся',
    ' * в том же окне. Новые окна открывает только рабочий стол.',
    ' */',
    'function deskNavigate(name) {',
    '  const win = activeDeskWindow();',
    '',
    '  if (!win) {',
    '    openDeskWindow(name);',
    '    return;',
    '  }',
    '',
    "  const view = document.getElementById('view-' + name);",
    '  if (!view) return;',
    '',
    "  const body = win.querySelector('.desk-window-body');",
    '  if (!body) return;',
    '',
    '  // Убираем прежнее содержимое окна на страницу',
    "  [...body.querySelectorAll('.view')].forEach((old) => {",
    '    if (old !== view) detachViewFromWindows(old);',
    '  });',
    '',
    '  // Если раздел уже открыт в другом окне — забираем его сюда',
    '  const other = win.parentElement.querySelector(\'[data-window]\');',
    '  win.parentElement.querySelectorAll(\'.desk-window\').forEach((item) => {',
    '    if (item === win) return;',
    "    if (item.querySelector('#view-' + name)) {",
    '      detachViewFromWindows(view);',
    '    }',
    '  });',
    '',
    '  body.appendChild(view);',
    "  view.classList.remove('hidden');",
    '',
    "  win.dataset.view = name;",
    "  win.dataset.title = windowTitle(name);",
    '',
    '  focusDeskWindow(win.dataset.window);',
    '  refreshWindowTitles();',
    "  state.view = name;",
    '',
    "  if (name === 'orders') loadOrders();",
    "  if (name === 'chat') openGeneralChat();",
    "  if (name === 'report') loadReport();",
    "  if (name === 'refs') loadRefs();",
    "  if (name === 'clients') loadClients();",
    "  if (name === 'stock') loadWarehouse();",
    "  if (name === 'tds') loadTdsView();",
    "  if (name === 'norms') loadNormsView();",
    "  if (name === 'users') loadUsers();",
    "  if (name === 'tasks') loadTasks();",
    '}',
    '',
    '/** «Стол»: сворачиваем окна, содержимое остаётся на месте. */',
    'function minimizeAllDeskWindows() {',
    "  const host = $('#deskWindows');",
    "  if (host) host.querySelectorAll('.desk-window').forEach((win) => win.classList.add('minimized'));",
    '',
    '  showDeskHome();',
    '  renderDeskTaskbar();',
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block + anchor);
  changed++;
  console.log('добавлены навигация внутри окна и «свернуть всё»');
}

/* ---------- 5. Заголовок окна — по текущему содержимому ---------- */

if (app.includes("  if (name === 'order' && state.order) return `Заказ ${state.order.number}`;")) {
  app = app.replace(
    "function windowTitle(name) {\n  if (name === 'order' && state.order) return `Заказ ${state.order.number}`;",
    "function windowTitle(name) {\n  if (name === 'order' && state.order) return `Заказ ${state.order.number}`;"
  );
}

if (!app.includes('win.dataset.title')) {
  console.log('заголовки окон: обновляются в deskNavigate');
}

const oldTitles = [
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
  '}'
].join('\n');

const newTitles = [
  'function refreshWindowTitles() {',
  "  const host = $('#deskWindows');",
  '  if (!host) return;',
  '',
  "  host.querySelectorAll('.desk-window').forEach((win) => {",
  "    const title = win.querySelector('.desk-window-title');",
  "    if (title) title.textContent = win.dataset.title || windowTitle(win.dataset.window);",
  '  });',
  '',
  '  renderDeskTaskbar();',
  '}'
].join('\n');

if (app.includes(oldTitles)) {
  app = app.replace(oldTitles, newTitles);
  changed++;
  console.log('заголовки окон: из data-title');
}

/* панель задач тоже подписывает по текущему содержимому */
const oldTaskbarTitle = "    return `<button class=\"desk-task ${active ? 'active' : ''}\" data-task=\"${esc(name)}\">${esc(windowTitle(name))}</button>`;";

if (app.includes(oldTaskbarTitle)) {
  app = app.replace(
    oldTaskbarTitle,
    "    const label = win.dataset.title || windowTitle(name);\n\n    return `<button class=\"desk-task ${active ? 'active' : ''}\" data-task=\"${esc(name)}\">${esc(label)}</button>`;"
  );
  changed++;
  console.log('панель задач: подпись по содержимому');
}

/* ---------- 6. Закрытие окна возвращает все его разделы ---------- */

const oldClose = [
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
  '}'
].join('\n');

const newClose = [
  'function closeDeskWindow(name) {',
  "  const host = $('#deskWindows');",
  '  if (!host) return;',
  '',
  "  const win = host.querySelector('[data-window=\"' + name + '\"]');",
  '',
  '  if (win) {',
  "    win.querySelectorAll('.view').forEach((view) => detachViewFromWindows(view));",
  '    win.remove();',
  '  }',
  '',
  '  renderDeskTaskbar();',
  '  showDeskHome();',
  '}'
].join('\n');

if (app.includes(oldClose)) {
  app = app.replace(oldClose, newClose);
  changed++;
  console.log('закрытие: все разделы окна возвращаются');
}

/* ---------- 7. Кнопки навигации в режиме стола открывают окно ---------- */

const oldNavBind = [
  "    $$('.nav-btn').forEach((button) => {",
  "      button.addEventListener('click', () => showView(button.dataset.view));",
  '    });'
].join('\n');

const newNavBind = [
  "    $$('.nav-btn').forEach((button) => {",
  "      button.addEventListener('click', () => {",
  '        const target = button.dataset.view;',
  '',
  "        if (typeof uiMode === 'function' && uiMode() === 'desk') {",
  "          if (target === 'home') { minimizeAllDeskWindows(); return; }",
  '',
  '          openDeskWindow(target);',
  '          return;',
  '        }',
  '',
  '        showView(target);',
  '      });',
  '    });'
].join('\n');

if (app.includes(oldNavBind)) {
  app = app.replace(oldNavBind, newNavBind);
  changed++;
  console.log('навигация в шапке открывает окна');
}

fs.writeFileSync(appFile, app);
console.log('изменений:', changed);
