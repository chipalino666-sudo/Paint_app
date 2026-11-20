'use strict';

/*
 * Временное логирование входов: кто, когда, откуда и с какого устройства.
 *
 *   node tools/patch-logins.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, text) => fs.writeFileSync(file, text);

let changed = 0;

/* ---------- 1. db.js: таблица ---------- */

let db = read(path.join(root, 'server', 'db.js'));

if (!db.includes('CREATE TABLE IF NOT EXISTS logins')) {
  const anchor = '/* Доска задач: общие дела цеха, с датами и напоминаниями */';

  if (!db.includes(anchor)) {
    console.error('db.js: не нашёл место для таблицы');
    process.exit(1);
  }

  const table = [
    '/* Входы в программу: временный журнал для администратора */',
    'CREATE TABLE IF NOT EXISTS logins (',
    '  id        INTEGER PRIMARY KEY,',
    '  user_id   INTEGER,',
    '  login     TEXT,',
    '  full_name TEXT,',
    '  result    TEXT NOT NULL DEFAULT \'ok\',',
    '  method    TEXT NOT NULL DEFAULT \'password\',',
    '  ip        TEXT,',
    '  agent     TEXT,',
    '  created_at TEXT NOT NULL',
    ');',
    '',
    'CREATE INDEX IF NOT EXISTS logins_at_idx ON logins(created_at);',
    '',
    anchor
  ].join('\n');

  db = db.replace(anchor, table);
  write(path.join(root, 'server', 'db.js'), db);
  changed++;
  console.log('db.js: таблица logins');
}

/* ---------- 2. server.js: запись и выдача ---------- */

let server = read(path.join(root, 'server', 'server.js'));

if (!server.includes('function logLogin')) {
  const anchor = "route('POST', '/api/login', async ({ body, res, req }) => {";

  if (!server.includes(anchor)) {
    console.error('server.js: не нашёл маршрут входа');
    process.exit(1);
  }

  const helper = [
    '/** Пишем вход в журнал: даже неудачный. */',
    'function logLogin(req, { user, login, result, method }) {',
    '  try {',
    "    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()",
    "      || (req.socket && req.socket.remoteAddress) || '';",
    '',
    "    db.prepare('INSERT INTO logins (user_id, login, full_name, result, method, ip, agent, created_at)'",
    "      + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)')",
    '      .run(',
    '        user ? user.id : null,',
    '        login || (user ? user.login : null),',
    '        user ? user.full_name : null,',
    '        result,',
    '        method,',
    '        ip,',
    "        str(req.headers['user-agent'], 300),",
    '        nowISO()',
    '      );',
    '  } catch (error) {',
    '    // Журнал не должен ломать вход',
    '  }',
    '}',
    '',
    anchor
  ].join('\n');

  server = server.replace(anchor, () => helper);
  changed++;
  console.log('server.js: функция записи входа');
}

/* успешный вход */
if (!server.includes("logLogin(req, { user, login, result: 'ok', method: 'password' });")) {
  server = server.replace(
    "  audit(user.id, 'login', 'user', user.id, null);",
    "  audit(user.id, 'login', 'user', user.id, null);\n  logLogin(req, { user, login, result: 'ok', method: 'password' });"
  );
  changed++;
  console.log('server.js: успешный вход пишется');
}

/* неудачный вход */
if (!server.includes("result: 'fail'")) {
  server = server.replace(
    "    // Одинаковый ответ: не подсказываем, существует ли такой логин\n    throw new ApiError(401, 'Неверный логин или пароль');",
    "    logLogin(req, { user: user || null, login, result: 'fail', method: 'password' });\n\n    // Одинаковый ответ: не подсказываем, существует ли такой логин\n    throw new ApiError(401, 'Неверный логин или пароль');"
  );
  changed++;
  console.log('server.js: неудачный вход пишется');
}

/* выдача журнала — только админу */
if (!server.includes("'/api/logins'")) {
  const anchor2 = "  route('PUT', '/api/me/desk'";

  if (!server.includes(anchor2)) {
    console.error('server.js: не нашёл место для выдачи журнала');
    process.exit(1);
  }

  const route = [
    '/** Журнал входов: только администратор, временная функция. */',
    "route('GET', '/api/logins', async ({ user, url }) => {",
    "  if (user.role !== 'admin') throw new ApiError(403, 'Журнал входов видит только администратор');",
    '',
    "  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);",
    '',
    '  const rows = db.prepare(`',
    '    SELECT id, login, full_name, result, method, ip, agent, created_at',
    '      FROM logins',
    '     ORDER BY id DESC',
    '     LIMIT ?',
    '  `).all(limit);',
    '',
    '  return {',
    '    logins: rows.map((row) => ({',
    '      id: row.id,',
    '      login: row.login,',
    '      name: row.full_name,',
    '      result: row.result,',
    '      method: row.method,',
    '      ip: row.ip,',
    '      agent: row.agent,',
    '      at: row.created_at',
    '    }))',
    '  };',
    '});',
    '',
    anchor2
  ].join('\n');

  server = server.replace(anchor2, () => route);
  changed++;
  console.log('server.js: маршрут /api/logins');
}

write(path.join(root, 'server', 'server.js'), server);

/* ---------- 3. index.html: раздел ---------- */

let html = read(path.join(root, 'server', 'public', 'index.html'));

if (!html.includes('id="view-logins"')) {
  const view = [
    '    <!-- ======================= ВХОДЫ ======================= -->',
    '    <section class="view hidden" id="view-logins">',
    '      <h1 class="page-title">Входы в программу</h1>',
    '',
    '      <div class="card">',
    '        <div class="card-head">',
    '          <h2>Кто и когда заходил</h2>',
    '          <span class="muted">временный журнал, видят только администраторы</span>',
    '        </div>',
    '',
    '        <div class="toolbar">',
    '          <button class="btn btn-outline btn-sm" id="btnLoginsRefresh">Обновить</button>',
    '          <span class="muted" id="loginsCount"></span>',
    '        </div>',
    '',
    '        <div id="loginsList"></div>',
    '      </div>',
    '    </section>',
    '',
    '    <!-- ======================= КЛИЕНТЫ ======================= -->'
  ].join('\n');

  const anchor = '    <!-- ======================= КЛИЕНТЫ ======================= -->';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл место для раздела');
    process.exit(1);
  }

  html = html.replace(anchor, view);
  changed++;
  console.log('index.html: раздел входов');
}

if (!html.includes('id="navLogins"')) {
  html = html.replace(
    '<button class="nav-btn menu-item hidden" data-view="users" id="navUsers">Сотрудники</button>',
    '<button class="nav-btn menu-item hidden" data-view="logins" id="navLogins">Входы</button>\n          <button class="nav-btn menu-item hidden" data-view="users" id="navUsers">Сотрудники</button>'
  );
  changed++;
  console.log('index.html: пункт меню «Входы»');
}

write(path.join(root, 'server', 'public', 'index.html'), html);

/* ---------- 4. app.js: загрузка и показ ---------- */

let app = read(path.join(root, 'server', 'public', 'app.js'));

if (!app.includes('loadLogins')) {
  const anchor = 'async function loadUsers() {';

  if (!app.includes(anchor)) {
    console.error('app.js: не нашёл loadUsers');
    process.exit(1);
  }

  const block = [
    '/** Журнал входов (видит только администратор). */',
    'async function loadLogins() {',
    "  const host = $('#loginsList');",
    '  if (!host) return;',
    '',
    '  host.innerHTML = \'<div class="spinner">Загрузка…</div>\';',
    '',
    '  try {',
    "    const data = await api('/api/logins?limit=200');",
    '    const list = data.logins || [];',
    '',
    "    const counter = $('#loginsCount');",
    '    if (counter) counter.textContent = list.length ? `записей: ${list.length}` : \'\';',
    '',
    '    if (!list.length) {',
    '      host.innerHTML = \'<div class="empty-line">Пока никто не заходил</div>\';',
    '      return;',
    '    }',
    '',
    '    host.innerHTML = `',
    '      <table class="grid">',
    '        <thead><tr><th>Когда</th><th>Кто</th><th>Логин</th><th>Итог</th><th>IP</th><th>Устройство</th></tr></thead>',
    '        <tbody>',
    '          ${list.map((row) => `',
    '            <tr>',
    '              <td class="mono">${esc(new Date(row.at).toLocaleString(\'ru-RU\', { day: \'2-digit\', month: \'2-digit\', year: \'2-digit\', hour: \'2-digit\', minute: \'2-digit\' }))}</td>',
    '              <td>${esc(row.name || \'—\')}</td>',
    '              <td class="code-cell">${esc(row.login || \'—\')}</td>',
    '              <td>${row.result === \'ok\' ? \'<span class="login-ok">вошёл</span>\' : \'<span class="login-fail">отказ</span>\'}</td>',
    '              <td class="mono muted">${esc(row.ip || \'—\')}</td>',
    '              <td class="muted login-agent">${esc(shortAgent(row.agent))}</td>',
    '            </tr>`).join(\'\')}',
    '        </tbody>',
    '      </table>',
    '    `;',
    '  } catch (error) {',
    '    host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;',
    '  }',
    '}',
    '',
    '/** Короткое описание браузера и системы. */',
    'function shortAgent(agent) {',
    '  const text = String(agent || \'\');',
    '  if (!text) return \'—\';',
    '',
    '  const browser = /Edg\\//.test(text) ? \'Edge\'',
    '    : /OPR\\//.test(text) ? \'Opera\'',
    '    : /Chrome\\//.test(text) ? \'Chrome\'',
    '    : /Firefox\\//.test(text) ? \'Firefox\'',
    '    : /Safari\\//.test(text) ? \'Safari\'',
    '    : \'браузер\';',
    '',
    '  const system = /Android/.test(text) ? \'Android\'',
    '    : /iPhone|iPad/.test(text) ? \'iOS\'',
    '    : /Windows/.test(text) ? \'Windows\'',
    '    : /Mac OS/.test(text) ? \'macOS\'',
    '    : /Linux/.test(text) ? \'Linux\'',
    '    : \'\';',
    '',
    '  return system ? `${browser} · ${system}` : browser;',
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block);
  changed++;
  console.log('app.js: загрузка журнала входов');
}

if (!app.includes("if (name === 'logins') loadLogins();")) {
  app = app.replace(
    "  if (name === 'users') loadUsers();",
    "  if (name === 'users') loadUsers();\n  if (name === 'logins') loadLogins();"
  );
  changed++;
  console.log('app.js: раздел входов в showView');
}

if (!app.includes("$('#btnLoginsRefresh')")) {
  app = app.replace(
    "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);",
    "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);\n\n    if ($('#btnLoginsRefresh')) $('#btnLoginsRefresh').addEventListener('click', loadLogins);"
  );
  changed++;
  console.log('app.js: кнопка обновления');
}

write(path.join(root, 'server', 'public', 'app.js'), app);

/* ---------- 5. стили ---------- */

const cssFile = path.join(root, 'server', 'public', 'extra.css');
let css = read(cssFile);

if (!css.includes('.login-ok')) {
  css += `

/* ---------- Журнал входов -------------------------------------------------- */

.login-ok { color: var(--green); font-weight: 700; }
.login-fail { color: var(--red); font-weight: 700; }
.login-agent { font-size: 12px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
  write(cssFile, css);
  changed++;
  console.log('extra.css: стили журнала');
}

console.log('изменений:', changed);
