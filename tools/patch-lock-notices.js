'use strict';

/*
 * Уведомления на экране ПИН-кода + счётчик на значке приложения.
 *
 *   1. Сервер: /api/push/workstation — события для общего экрана мастеров
 *   2. web: баннер на экране ПИН-кода
 *   3. android: число на значке приложения
 *
 *   node tools/patch-lock-notices.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverFile = path.join(root, 'server', 'server.js');
const publicDir = path.join(root, 'server', 'public');

let changed = 0;

/* ---------------- 1. Серверный маршрут ---------------- */

let server = fs.readFileSync(serverFile, 'utf8').replace(/\r\n/g, '\n');

if (!server.includes("'/api/push/workstation'")) {
  const anchor = "  route('GET', '/api/push/pending'";

  if (!server.includes(anchor)) {
    console.error('server.js: не нашёл место для маршрута');
    process.exit(1);
  }

  const route = [
    '/**',
    ' * События для общего экрана мастеров: экран ПИН-кода тоже должен',
    ' * показывать уведомления, хотя человек ещё не вошёл.',
    ' */',
    "route('GET', '/api/push/workstation', async ({ sessionData, url }) => {",
    "  if (!sessionData) throw new ApiError(401, 'Нужно войти');",
    '',
    "  const since = Number(url.searchParams.get('since')) || 0;",
    "  const wait = Math.min(Math.max(Number(url.searchParams.get('timeout')) || 25, 5), 50);",
    '  const deadline = Date.now() + wait * 1000;',
    '',
    '  while (true) {',
    '    const rows = db.prepare(`',
    '      SELECT id, kind, title, body, created_at',
    '        FROM push_events',
    '       WHERE id > ?',
    '       ORDER BY id ASC',
    '       LIMIT 20',
    '    `).all(since);',
    '',
    '    if (rows.length) {',
    '      return { events: rows, last: rows[rows.length - 1].id };',
    '    }',
    '',
    '    if (Date.now() > deadline) {',
    "      const maxId = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM push_events').get().id;",
    '      return { events: [], last: Math.max(Number(maxId), since) };',
    '    }',
    '',
    '    await new Promise((resolve) => setTimeout(resolve, 1500));',
    '  }',
    '});',
    '',
    anchor
  ].join('\n');

  server = server.replace(anchor, () => route);
  changed++;
  console.log('server.js: маршрут для экрана ПИН-кода');
}

/* доступ без «вошедшего» пользователя (сессия есть, ПИН не введён) */
if (!server.includes("'/api/push/workstation'").toString().includes('alwaysAllowed')) {
  const before = "const alwaysAllowed = ['/api/login', '/api/unlock', '/api/lock', '/api/me', '/api/logout', '/api/app/version'].includes(pathname);";

  if (server.includes(before)) {
    server = server.replace(before, "const alwaysAllowed = ['/api/login', '/api/unlock', '/api/lock', '/api/me', '/api/logout', '/api/app/version', '/api/push/workstation'].includes(pathname);");
    changed++;
    console.log('server.js: путь доступен до ввода ПИНа');
  }
}

fs.writeFileSync(serverFile, server);

/* ---------------- 2. Разметка баннера ---------------- */

const htmlFile = path.join(publicDir, 'index.html');
let html = fs.readFileSync(htmlFile, 'utf8').replace(/\r\n/g, '\n');

if (!html.includes('id="pinNotices"')) {
  html = html.replace(
    '<div class="pin-screen hidden" id="pinScreen">',
    '<div class="pin-screen hidden" id="pinScreen">\n  <div class="pin-notices" id="pinNotices"></div>'
  );

  fs.writeFileSync(htmlFile, html);
  changed++;
  console.log('index.html: контейнер уведомлений на экране ПИН');
}

/* ---------------- 3. Клиент: опрос и баннер ---------------- */

const appFile = path.join(publicDir, 'app.js');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

if (!app.includes('startLockNotices')) {
  const anchor = '  function showPinScreen() {';

  const block = [
    '  /* Уведомления на экране ПИН-кода: экран общий, поэтому показываем всё подряд */',
    '',
    "  let lockWatchSince = Number(localStorage.getItem('paintShopLockSince') || 0);",
    '  let lockWatchTimer = null;',
    '',
    '  function startLockNotices() {',
    '    if (lockWatchTimer) return;',
    '    lockWatchTimer = setTimeout(runLockNotices, 300);',
    '  }',
    '',
    '  function stopLockNotices() {',
    '    clearTimeout(lockWatchTimer);',
    '    lockWatchTimer = null;',
    '  }',
    '',
    '  async function runLockNotices() {',
    "    const screen = $('#pinScreen');",
    '',
    '    if (!screen || screen.classList.contains(\'hidden\')) {',
    '      lockWatchTimer = null;',
    '      return;',
    '    }',
    '',
    '    try {',
    "      const data = await api('/api/push/workstation?since=' + lockWatchSince + '&timeout=25');",
    '',
    '      for (const event of data.events || []) showLockNotice(event);',
    '',
    '      if (data.last) {',
    '        lockWatchSince = Number(data.last);',
    "        localStorage.setItem('paintShopLockSince', String(lockWatchSince));",
    '      }',
    '    } catch (error) {',
    '      /* нет связи — попробуем позже */',
    '    }',
    '',
    '    lockWatchTimer = setTimeout(runLockNotices, 1200);',
    '  }',
    '',
    '  /** Крупная плашка поверх экрана ПИН-кода. */',
    '  function showLockNotice(event) {',
    "    const box = $('#pinNotices');",
    '    if (!box) return;',
    '',
    "    const card = document.createElement('div');",
    "    card.className = 'pin-notice';",
    '',
    "    const title = document.createElement('div');",
    "    title.className = 'pin-notice-title';",
    '    title.textContent = event.title || \'Лонжерон\';',
    '',
    "    const body = document.createElement('div');",
    "    body.className = 'pin-notice-body';",
    "    body.textContent = event.body || '';",
    '',
    '    card.appendChild(title);',
    '    card.appendChild(body);',
    '    box.prepend(card);',
    '',
    '    while (box.children.length > 3) box.lastElementChild.remove();',
    '',
    '    playPing();',
    '',
    '    setTimeout(() => card.classList.add(\'fade-out\'), 25000);',
    '    setTimeout(() => card.remove(), 27000);',
    '  }',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block);
  changed++;
  console.log('app.js: опрос событий и баннер');
}

/* запускаем на экране ПИН, останавливаем после входа */
if (!app.includes('startLockNotices();\n')) {
  app = app.replace(
    "  function showPinScreen() {\n    $('#pinScreen').classList.remove('hidden');",
    "  function showPinScreen() {\n    $('#pinScreen').classList.remove('hidden');\n    startLockNotices();"
  );

  changed++;
  console.log('app.js: показ ПИНа запускает опрос');
}

if (!app.includes('stopLockNotices();')) {
  app = app.replace(
    "    $('#pinScreen').classList.add('hidden');",
    "    stopLockNotices();\n    $('#pinScreen').classList.add('hidden');"
  );

  changed++;
  console.log('app.js: вход останавливает опрос');
}

fs.writeFileSync(appFile, app);

/* ---------------- 4. Стили баннера ---------------- */

const cssFile = path.join(publicDir, 'extra.css');
let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

if (!css.includes('.pin-notice {')) {
  css += `

/* ---------- Уведомления на экране ПИН-кода ------------------------------- */

.pin-notices {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  width: min(620px, calc(100% - 24px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 5;
  pointer-events: none;
}

.pin-notice {
  padding: 14px 16px 14px 18px;
  border-radius: 14px;
  border: 1px solid var(--border);
  border-left: 6px solid var(--blue);
  background: var(--surface);
  box-shadow: 0 14px 34px rgba(15, 23, 42, .22);
  animation: pinNoticeIn .25s ease-out;
  transition: opacity .5s ease;
}

.pin-notice.fade-out { opacity: 0; }

.pin-notice-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 4px;
}

.pin-notice-body {
  font-size: 15px;
  color: var(--ink-soft);
  line-height: 1.35;
}

@keyframes pinNoticeIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: none; }
}

@media (max-width: 780px) {
  .pin-notices { top: 8px; width: calc(100% - 16px); }
  .pin-notice { padding: 12px 13px 12px 15px; }
  .pin-notice-title { font-size: 15.5px; }
  .pin-notice-body { font-size: 14px; }
}
`;
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: стили плашек');
}

console.log('изменений:', changed);
