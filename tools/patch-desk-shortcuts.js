'use strict';

/*
 * Ярлыки рабочего стола: свой набор плиток у каждого пользователя.
 *
 *   node tools/patch-desk-shortcuts.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, text) => fs.writeFileSync(file, text);

let changed = 0;

/* ---------- 1. db.js ---------- */

let db = read(path.join(root, 'server', 'db.js'));

if (!db.includes("addColumn('users', 'desk_items'")) {
  const anchor = "addColumn('users', 'nav_items', 'TEXT');";
  db = db.replace(anchor, anchor + "\naddColumn('users', 'desk_items', 'TEXT');");
  write(path.join(root, 'server', 'db.js'), db);
  changed++;
  console.log('db.js: колонка desk_items');
}

/* ---------- 2. server.js ---------- */

let server = read(path.join(root, 'server', 'server.js'));

if (!server.includes("'/api/me/desk'")) {
  const anchor = "  route('PUT', '/api/me/nav'";

  if (!server.includes(anchor)) {
    console.error('server.js: не нашёл маршрут пунктов шапки');
    process.exit(1);
  }

  const route = [
    '/** Ярлыки на рабочем столе: свой набор у каждого. */',
    "route('PUT', '/api/me/desk', async ({ user, body }) => {",
    "  const allowed = ['orders', 'accepted', 'in_work', 'ready', 'tasks', 'lowstock', 'stock', 'tds',",
    "    'norms', 'refs', 'report', 'clients', 'chat', 'ai', 'new', 'users'];",
    '',
    '  const items = (Array.isArray(body.items) ? body.items : [])',
    '    .map((item) => String(item))',
    '    .filter((item) => allowed.includes(item))',
    '    .slice(0, 16);',
    '',
    "  db.prepare('UPDATE users SET desk_items = ? WHERE id = ?').run(JSON.stringify(items), user.id);",
    '',
    '  return { ok: true, items };',
    '});',
    '',
    anchor
  ].join('\n');

  server = server.replace(anchor, () => route);
  changed++;
  console.log('server.js: маршрут ярлыков');
}

/* отдаём ярлыки вместе с пользователем */
if (!server.includes('desk_items: parseNavItems')) {
  server = server.replace(
    "  const row = db.prepare('SELECT nav_items FROM users WHERE id = ?').get(user.id);\n\n  return { ...user, nav_items: parseNavItems(row) };",
    "  const row = db.prepare('SELECT nav_items, desk_items FROM users WHERE id = ?').get(user.id);\n\n  return { ...user, nav_items: parseNavItems(row), desk_items: parseModeItems(row && row.desk_items) };"
  );

  server = server.replace(
    "function withNavItems(user) {",
    "function parseModeItems(value) {\n  try {\n    const saved = JSON.parse(value || 'null');\n    return Array.isArray(saved) ? saved : null;\n  } catch (error) {\n    return null;\n  }\n}\n\nfunction withNavItems(user) {"
  );

  changed++;
  console.log('server.js: desk_items в /api/me');
}

write(path.join(root, 'server', 'server.js'), server);

/* ---------- 3. index.html: окно выбора ярлыков ---------- */

let html = read(path.join(root, 'server', 'public', 'index.html'));

if (!html.includes('id="deskPrefsModal"')) {
  const anchor = '  <!-- ======================= НАСТРОЙКА ШАПКИ ======================= -->';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл место для окна');
    process.exit(1);
  }

  const modal = [
    '  <!-- ======================= ЯРЛЫКИ СТОЛА ======================= -->',
    '  <div class="modal" id="deskPrefsModal">',
    '    <div class="modal-box" style="max-width:480px">',
    '      <div class="modal-head">',
    '        <h3>Ярлыки на рабочем столе</h3>',
    '        <button class="modal-close" id="btnCloseDeskPrefs">×</button>',
    '      </div>',
    '',
    '      <div class="modal-body">',
    '        <p class="muted" style="margin-top:0;font-size:12.5px">',
    '          Отметьте, что должно быть на столе. Набор сохранится только у вас.',
    '        </p>',
    '        <div class="nav-prefs" id="deskPrefsList"></div>',
    '      </div>',
    '',
    '      <div class="modal-foot">',
    '        <button class="btn btn-outline" id="btnDeskPrefsReset">Сбросить</button>',
    '        <span class="spacer"></span>',
    '        <button class="btn btn-outline" id="btnDeskPrefsCancel">Отмена</button>',
    '        <button class="btn btn-primary" id="btnDeskPrefsSave">Сохранить</button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '',
    anchor
  ].join('\n');

  html = html.replace(anchor, modal);
  changed++;
  console.log('index.html: окно ярлыков');
}

write(path.join(root, 'server', 'public', 'index.html'), html);

/* ---------- 4. app.js ---------- */

let app = read(path.join(root, 'server', 'public', 'app.js'));

if (!app.includes('DESK_SHORTCUTS')) {
  const anchor = '/* --------------------------------------------------------------------------\n   Рабочий стол: плитки и быстрый поиск';
  const block = read(path.join(__dirname, 'desk-shortcuts.txt'));

  if (!app.includes(anchor)) {
    console.error('app.js: не нашёл блок рабочего стола');
    process.exit(1);
  }

  app = app.replace(anchor, () => block + '\n' + anchor);
  changed++;
  console.log('app.js: ярлыки добавлены');
}

/* loadDesk рисует ярлыки */
if (app.includes('function loadDesk() {') && !app.includes('renderDeskShortcuts();')) {
  const start = app.indexOf('function loadDesk() {');
  const end = app.indexOf('\n}\n', start);

  if (start > 0 && end > start) {
    const fresh = [
      'function loadDesk() {',
      "  const grid = $('#deskGrid');",
      '  if (!grid) return;',
      '',
      '  const user = state.user || {};',
      "  const hello = $('#deskHello');",
      '',
      '  if (hello) {',
      '    const hour = new Date().getHours();',
      "    const part = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';",
      "    const parts = String(user.full_name || '').trim().split(/\\s+/).filter(Boolean);",
      '    const name = parts.length > 1 ? parts[1] : parts[0];',
      "    hello.textContent = name ? `${part}, ${name}` : 'Рабочий стол';",
      '  }',
      '',
      "  const clock = $('#deskClock');",
      '  if (clock) {',
      '    const now = new Date();',
      "    clock.textContent = now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })",
      "      + ', ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });",
      '  }',
      '',
      '  renderDeskDock();',
      '  renderDeskShortcuts();',
      '}'
    ].join('\n');

    app = app.slice(0, start) + fresh + app.slice(end + 3);
    changed++;
    console.log('app.js: loadDesk рисует ярлыки');
  }
}

/* обработчики окна ярлыков */
if (!app.includes("$('#btnDeskPrefsSave')")) {
  app = app.replace(
    "    if ($('#btnNavPrefs')) $('#btnNavPrefs').addEventListener('click', openNavPrefs);",
    [
      "    if ($('#btnNavPrefs')) $('#btnNavPrefs').addEventListener('click', openNavPrefs);",
      '',
      "    if ($('#btnDeskPrefsSave')) $('#btnDeskPrefsSave').addEventListener('click', saveDeskPrefs);",
      "    if ($('#btnDeskPrefsCancel')) $('#btnDeskPrefsCancel').addEventListener('click', () => $('#deskPrefsModal').classList.remove('open'));",
      "    if ($('#btnCloseDeskPrefs')) $('#btnCloseDeskPrefs').addEventListener('click', () => $('#deskPrefsModal').classList.remove('open'));",
      "    if ($('#btnDeskPrefsReset')) $('#btnDeskPrefsReset').addEventListener('click', () => {",
      "      $$('#deskPrefsList input').forEach((input) => {",
      "        input.checked = DEFAULT_DESK.includes(input.value) && (!input.disabled);",
      '      });',
      '    });'
    ].join('\n')
  );

  changed++;
  console.log('app.js: обработчики ярлыков');
}

write(path.join(root, 'server', 'public', 'app.js'), app);

/* ---------- 5. Стили ---------- */

const cssFile = path.join(root, 'server', 'public', 'extra.css');
let css = read(cssFile);

if (!css.includes('.desk-tile-add')) {
  css += `

/* Плитка «добавить ярлык» */
.desk-tile-add {
  border: 1px dashed var(--border);
  background: transparent;
  opacity: .7;
}

.desk-tile-add:hover {
  opacity: 1;
  border-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
}

.desk-tile-add .desk-tile-icon { opacity: .8; }
`;
  write(cssFile, css);
  changed++;
  console.log('extra.css: стиль плитки добавления');
}

console.log('изменений:', changed);
