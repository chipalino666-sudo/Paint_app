'use strict';

/*
 * Личная настройка шапки: каждый выбирает свои пункты, выбор сохраняется.
 *
 * 1. db.js — колонка nav_items у пользователя
 * 2. server.js — отдаём выбор в /api/me и сохраняем через /api/me/nav
 * 3. index.html — контейнер под пункты шапки и окно настройки
 * 4. app.js — применение выбора и сохранение
 *
 *   node tools/patch-nav-prefs.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, text) => fs.writeFileSync(file, text);

let changed = 0;

/* ---------- 1. db.js ---------- */

let db = read(path.join(root, 'server', 'db.js'));

if (!db.includes("addColumn('users', 'nav_items'")) {
  const anchor = "addColumn('users', 'is_workstation', 'INTEGER NOT NULL DEFAULT 0');";

  if (!db.includes(anchor)) {
    console.error('db.js: не нашёл место для колонки');
    process.exit(1);
  }

  db = db.replace(anchor, anchor + "\naddColumn('users', 'nav_items', 'TEXT');");
  write(path.join(root, 'server', 'db.js'), db);
  changed++;
  console.log('db.js: колонка nav_items');
}

/* ---------- 2. server.js ---------- */

let server = read(path.join(root, 'server', 'server.js'));

if (!server.includes("'/api/me/nav'")) {
  const anchor = "  route('GET', '/api/me'";

  if (!server.includes(anchor)) {
    console.error('server.js: не нашёл /api/me');
    process.exit(1);
  }

  const routes = [
    '/** Личные пункты шапки: каждый мастер выбирает своё. */',
    "route('PUT', '/api/me/nav', async ({ user, body }) => {",
    '  const allowed = [\'orders\', \'chat\', \'tasks\', \'stock\', \'tds\', \'norms\', \'report\', \'clients\', \'refs\', \'users\'];',
    '',
    '  const items = (Array.isArray(body.items) ? body.items : [])',
    '    .map((item) => String(item))',
    '    .filter((item) => allowed.includes(item))',
    '    .slice(0, 8);',
    '',
    "  db.prepare('UPDATE users SET nav_items = ? WHERE id = ?').run(JSON.stringify(items), user.id);",
    '',
    '  return { ok: true, items };',
    '});',
    '',
    anchor
  ].join('\n');

  server = server.replace(anchor, () => routes);
  changed++;
  console.log('server.js: маршрут настройки шапки');
}

fs.writeFileSync(path.join(root, 'server', 'server.js'), server);

/* ---------- 3. index.html ---------- */

let html = read(path.join(root, 'server', 'public', 'index.html'));

if (!html.includes('id="navExtra"')) {
  const anchor = '      <div class="nav-more">';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл nav-more');
    process.exit(1);
  }

  html = html.replace(anchor, '      <span class="nav-extra" id="navExtra"></span>\n\n' + anchor);
  changed++;
  console.log('index.html: контейнер для пунктов шапки');
}

if (!html.includes('id="navPrefsModal"')) {
  const anchor = '  <!-- ======================= РЕДАКТОР КРАСКИ ======================= -->';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл место для окна настройки');
    process.exit(1);
  }

  const modal = [
    '  <!-- ======================= НАСТРОЙКА ШАПКИ ======================= -->',
    '  <div class="modal" id="navPrefsModal">',
    '    <div class="modal-box" style="max-width:460px">',
    '      <div class="modal-head">',
    '        <h3>Пункты в шапке</h3>',
    '        <button class="modal-close" id="btnCloseNavPrefs">×</button>',
    '      </div>',
    '',
    '      <div class="modal-body">',
    '        <p class="muted" style="margin-top:0;font-size:12.5px">',
    '          Выберите, что показывать в шапке. Остальное всегда доступно в меню «Ещё».',
    '        </p>',
    '        <div class="nav-prefs" id="navPrefsList"></div>',
    '      </div>',
    '',
    '      <div class="modal-foot">',
    '        <button class="btn btn-outline" id="btnNavPrefsCancel">Отмена</button>',
    '        <button class="btn btn-primary" id="btnNavPrefsSave">Сохранить</button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '',
    anchor
  ].join('\n');

  html = html.replace(anchor, modal);
  changed++;
  console.log('index.html: окно настройки шапки');
}

if (!html.includes('id="btnNavPrefs"')) {
  html = html.replace(
    '<button class="menu-item" id="btnUiMode">Режим: обычный</button>',
    '<button class="menu-item" id="btnNavPrefs">Пункты в шапке</button>\n      <button class="menu-item" id="btnUiMode">Режим: обычный</button>'
  );
  changed++;
  console.log('index.html: пункт меню «Пункты в шапке»');
}

fs.writeFileSync(path.join(root, 'server', 'public', 'index.html'), html);

/* ---------- 4. app.js ---------- */

let app = read(path.join(root, 'server', 'public', 'app.js'));

if (!app.includes('NAV_ITEMS')) {
  const anchor = 'function uiMode() {';

  const block = [
    '/* --------------------------------------------------------------------------',
    '   Пункты шапки: у каждого пользователя свои',
    '   -------------------------------------------------------------------------- */',
    '',
    'const NAV_ITEMS = [',
    "  { view: 'orders', title: 'Заказы' },",
    "  { view: 'chat', title: 'Обсуждения' },",
    "  { view: 'tasks', title: 'Задачи' },",
    "  { view: 'stock', title: 'Склад' },",
    "  { view: 'tds', title: 'ТДС и паспорта' },",
    "  { view: 'norms', title: 'Нормы списания' },",
    "  { view: 'report', title: 'Отчёт' },",
    "  { view: 'clients', title: 'Клиенты' },",
    "  { view: 'refs', title: 'Справочники' },",
    "  { view: 'users', title: 'Сотрудники' }",
    '];',
    '',
    '/** Набор по умолчанию зависит от роли. */',
    'function defaultNavItems() {',
    '  const role = (state.user && state.user.role) || \'painter\';',
    '',
    "  if (role === 'admin' || role === 'manager') return ['orders', 'chat', 'tasks', 'stock'];",
    "  if (role === 'storekeeper' || role === 'store') return ['stock', 'tasks', 'chat', 'tds'];",
    "  if (role === 'master') return ['orders', 'chat', 'tds', 'tasks'];",
    '',
    "  return ['orders', 'chat', 'tds'];",
    '}',
    '',
    'function currentNavItems() {',
    '  const saved = state.user && state.user.nav_items;',
    '',
    '  if (Array.isArray(saved) && saved.length) return saved;',
    '',
    '  return defaultNavItems();',
    '}',
    '',
    '/** Раскладываем пункты: выбранные — в шапку, остальные — в меню «Ещё». */',
    'function applyNavPrefs(items) {',
    '  const list = Array.isArray(items) ? items : currentNavItems();',
    "  const extra = $('#navExtra');",
    "  const menu = $('#moreMenu');",
    '',
    '  if (!extra || !menu) return;',
    '',
    '  NAV_ITEMS.forEach((item) => {',
    "    const button = document.querySelector('.nav-btn[data-view=\"' + item.view + '\"]');",
    '    if (!button) return;',
    '',
    '    const inHeader = list.includes(item.view);',
    '',
    '    if (inHeader) {',
    '      button.classList.add(\'nav-btn-header\');',
    '      button.classList.remove(\'menu-item\');',
    '      extra.appendChild(button);',
    '    } else {',
    '      button.classList.remove(\'nav-btn-header\');',
    '      button.classList.add(\'menu-item\');',
    '      menu.appendChild(button);',
    '    }',
    '  });',
    '',
    "  const more = $('.nav-more');",
    '  if (more) more.classList.toggle(\'hidden\', !menu.children.length);',
    '}',
    '',
    '/** Окно выбора пунктов. */',
    'function openNavPrefs() {',
    "  const host = $('#navPrefsList');",
    '  const list = currentNavItems();',
    '',
    '  if (!host) return;',
    '',
    '  host.innerHTML = NAV_ITEMS.map((item) => {',
    "    const disabled = item.view === 'users' && state.user && state.user.role !== 'admin';",
    '',
    '    return `<label class="nav-pref ${disabled ? \'is-disabled\' : \'\'}">',
    '      <input type="checkbox" value="${esc(item.view)}" ${list.includes(item.view) ? \'checked\' : \'\'} ${disabled ? \'disabled\' : \'\'}>',
    '      <span>${esc(item.title)}</span>',
    '    </label>`;',
    "  }).join('');",
    '',
    "  $('#navPrefsModal').classList.add('open');",
    '}',
    '',
    'async function saveNavPrefs() {',
    "  const items = $$('#navPrefsList input:checked').map((input) => input.value);",
    '',
    '  try {',
    "    await api('/api/me/nav', { method: 'PUT', body: { items } });",
    '',
    '    if (state.user) state.user.nav_items = items;',
    '',
    '    applyNavPrefs(items);',
    "    $('#navPrefsModal').classList.remove('open');",
    "    toast('Шапка настроена');",
    '  } catch (error) {',
    '    toast(error.message);',
    '  }',
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block + anchor);
  changed++;
  console.log('app.js: логика пунктов шапки');
}

/* применение при старте */
if (!app.includes('applyNavPrefs')) {
  console.log('app.js: применение не найдено');
} else if (!app.includes('applyNavPrefs(currentNavItems());')) {
  app = app.replace(
    "      applyUiMode();\n      startClock();",
    "      applyUiMode();\n      startClock();\n      applyNavPrefs(currentNavItems());"
  );
  changed++;
  console.log('app.js: применяем при старте');
}

/* обработчики */
if (!app.includes("$('#btnNavPrefs')")) {
  app = app.replace(
    "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);",
    [
      "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);",
      "    if ($('#btnNavPrefs')) $('#btnNavPrefs').addEventListener('click', openNavPrefs);",
      "    if ($('#btnNavPrefsSave')) $('#btnNavPrefsSave').addEventListener('click', saveNavPrefs);",
      "    if ($('#btnNavPrefsCancel')) $('#btnNavPrefsCancel').addEventListener('click', () => $('#navPrefsModal').classList.remove('open'));",
      "    if ($('#btnCloseNavPrefs')) $('#btnCloseNavPrefs').addEventListener('click', () => $('#navPrefsModal').classList.remove('open'));"
    ].join('\n')
  );
  changed++;
  console.log('app.js: обработчики настройки');
}

write(path.join(root, 'server', 'public', 'app.js'), app);

/* ---------- 5. Стили ---------- */

const cssFile = path.join(root, 'server', 'public', 'extra.css');
let css = read(cssFile);

if (!css.includes('.nav-pref')) {
  css += `

/* ---------- Пункты шапки -------------------------------------------------- */

.nav-extra {
  display: contents;
}

.nav-btn.nav-btn-header {
  flex: 0 0 auto;
}

.nav-prefs {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}

.nav-pref {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.nav-pref input { width: 17px; height: 17px; accent-color: var(--blue); }
.nav-pref.is-disabled { opacity: .5; cursor: default; }
`;
  write(cssFile, css);
  changed++;
  console.log('extra.css: стили настройки шапки');
}

console.log('изменений:', changed);
