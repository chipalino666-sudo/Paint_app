'use strict';

/*
 * Открытые вкладки — вертикальная колонка слева, с иконками разделов.
 *
 *   node tools/patch-win-rail.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, text) => fs.writeFileSync(file, text);

let changed = 0;

/* ---------- index.html: колонка вместо строки в шапке ---------- */

let html = read(path.join(root, 'server', 'public', 'index.html'));

if (!html.includes('id="winRail"')) {
  const anchor = '    <div class="desk-windows" id="deskWindows"></div>';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл слой окон');
    process.exit(1);
  }

  html = html.replace(anchor, '    <aside class="win-rail hidden" id="winRail"></aside>\n\n' + anchor);
  changed++;
  console.log('index.html: колонка открытых вкладок');
}

const switcher = '  <div class="win-switcher hidden" id="winSwitcher"></div>\n\n';

if (html.includes(switcher)) {
  html = html.replace(switcher, '');
  changed++;
  console.log('index.html: строка в шапке убрана');
}

write(path.join(root, 'server', 'public', 'index.html'), html);

/* ---------- app.js: рисуем колонку ---------- */

let app = read(path.join(root, 'server', 'public', 'app.js'));

if (!app.includes('WINDOW_ICONS')) {
  app = app.replace(
    'const WINDOW_TITLES = {',
    [
      '/** Пиктограммы разделов — для колонки открытых вкладок. */',
      'const WINDOW_ICONS = {',
      "  orders: '📋',",
      "  order: '🧾',",
      "  new: '➕',",
      "  chat: '💬',",
      "  report: '📈',",
      "  clients: '👥',",
      "  stock: '📦',",
      "  tds: '📄',",
      "  norms: '⚖️',",
      "  refs: '📚',",
      "  users: '🧑‍🔧',",
      "  tasks: '🗒️',",
      "  home: '🏠'",
      '};',
      '',
      'const WINDOW_TITLES = {'
    ].join('\n')
  );

  changed++;
  console.log('app.js: иконки разделов');
}

const start = app.indexOf('function renderWinSwitcher() {');

if (start > 0) {
  const end = app.indexOf('\n}\n', start);

  const fresh = [
    'function renderWinSwitcher() {',
    "  const rail = $('#winRail');",
    '  if (!rail) return;',
    '',
    "  const host = $('#deskWindows');",
    "  const wins = host ? [...host.querySelectorAll('.desk-window')] : [];",
    '',
    "  if (!wins.length || uiMode() !== 'desk') {",
    "    rail.classList.add('hidden');",
    "    rail.innerHTML = '';",
    '    return;',
    '  }',
    '',
    "  rail.classList.remove('hidden');",
    '',
    '  const items = wins.map((win) => {',
    "    const active = win.classList.contains('active') && !win.classList.contains('minimized');",
    '    const label = win.dataset.title || windowTitle(win.dataset.window);',
    '    const icon = WINDOW_ICONS[win.dataset.view || win.dataset.window] || \'▫️\';',
    '',
    '    return `<button class="rail-item ${active ? \'active\' : \'\'}" data-rail="${esc(win.dataset.window)}" title="${esc(label)}">',
    '      <span class="rail-icon">${icon}</span>',
    '      <span class="rail-label">${esc(label)}</span>',
    '      <span class="rail-x" data-rail-close="${esc(win.dataset.window)}">×</span>',
    '    </button>`;',
    "  }).join('');",
    '',
    '  rail.innerHTML = `<button class="rail-item rail-home" data-rail-home="1" title="Свернуть всё и вернуться к столу">',
    '    <span class="rail-icon">🏠</span>',
    '    <span class="rail-label">Стол</span>',
    '  </button>` + items;',
    '',
    "  rail.querySelectorAll('[data-rail-home]').forEach((button) => {",
    "    button.addEventListener('click', () => minimizeAllDeskWindows());",
    '  });',
    '',
    "  rail.querySelectorAll('[data-rail]').forEach((button) => {",
    "    button.addEventListener('click', (event) => {",
    '      if (event.target.dataset.railClose) return;',
    '',
    '      const name = button.dataset.rail;',
    "      const win = host.querySelector('[data-window=\"' + name + '\"]');",
    '      if (!win) return;',
    '',
    "      if (win.classList.contains('active') && !win.classList.contains('minimized')) {",
    '        minimizeDeskWindow(name);',
    '        showDeskHome();',
    '      } else {',
    '        focusDeskWindow(name);',
    '        applyDeskLayout();',
    '      }',
    '    });',
    '  });',
    '',
    "  rail.querySelectorAll('[data-rail-close]').forEach((button) => {",
    "    button.addEventListener('click', (event) => {",
    '      event.stopPropagation();',
    '      closeDeskWindow(button.dataset.railClose);',
    '    });',
    '  });',
    '}'
  ].join('\n');

  app = app.slice(0, start) + fresh + app.slice(end + 3);
  changed++;
  console.log('app.js: колонка рисуется с иконками');
}

/* иконка в заголовке окна */
if (!app.includes('desk-window-icon')) {
  app = app.replace(
    '        <span class="desk-window-title"></span>',
    '        <span class="desk-window-icon"></span>\n        <span class="desk-window-title"></span>'
  );

  app = app.replace(
    "  host.querySelectorAll('.desk-window').forEach((win) => {\n    const title = win.querySelector('.desk-window-title');\n    if (title) title.textContent = win.dataset.title || windowTitle(win.dataset.window);\n  });",
    [
      "  host.querySelectorAll('.desk-window').forEach((win) => {",
      "    const title = win.querySelector('.desk-window-title');",
      "    const icon = win.querySelector('.desk-window-icon');",
      '',
      "    if (title) title.textContent = win.dataset.title || windowTitle(win.dataset.window);",
      "    if (icon) icon.textContent = WINDOW_ICONS[win.dataset.view || win.dataset.window] || '▫️';",
      '  });'
    ].join('\n')
  );

  changed++;
  console.log('app.js: иконка в заголовке окна');
}

write(path.join(root, 'server', 'public', 'app.js'), app);

/* ---------- extra.css ---------- */

const cssFile = path.join(root, 'server', 'public', 'extra.css');
let css = read(cssFile);

if (!css.includes('.win-rail')) {
  css += `

/* ---------- Колонка открытых вкладок -------------------------------------- */

.win-rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 208px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 8px;
  overflow-y: auto;
  background: color-mix(in srgb, var(--surface) 65%, transparent);
  border-right: 1px solid var(--border);
  backdrop-filter: blur(10px);
  pointer-events: auto;
  scrollbar-width: thin;
}

.win-rail.hidden { display: none; }

.rail-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: transparent;
  color: var(--ink-soft);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
}

.rail-item:hover { background: var(--surface-2); color: var(--ink); border-color: var(--border); }

.rail-item.active {
  background: linear-gradient(180deg, #5b9bff, var(--blue));
  border-color: var(--blue);
  color: #fff;
}

.rail-home { color: var(--ink); border-color: var(--border); background: var(--surface-2); }

.rail-icon { flex: 0 0 auto; font-size: 16px; line-height: 1; }

.rail-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-x { flex: 0 0 auto; font-size: 14px; opacity: .6; }
.rail-x:hover { opacity: 1; }

/* Окна сдвигаются вправо, чтобы колонка не перекрывала их */
.desk-windows { padding-left: 218px; }

/* Иконка в заголовке окна */
.desk-window-head { justify-content: flex-start; }
.desk-window-icon { font-size: 15px; line-height: 1; }
.desk-window-btns { margin-left: auto; }

@media (max-width: 900px) {
  .win-rail {
    position: static;
    width: auto;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .desk-windows { padding-left: 8px; }

  .rail-item { width: auto; white-space: nowrap; }
  .rail-label { max-width: 130px; }
}
`;
  write(cssFile, css);
  changed++;
  console.log('extra.css: стили колонки');
}

console.log('изменений:', changed);
