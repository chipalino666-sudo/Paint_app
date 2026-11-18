'use strict';

/*
 * Диспетчер окон в шапке:
 *  - открытые окна показываются кнопками прямо в шапке;
 *  - шапка всегда видна и не перекрывается окнами;
 *  - нижнюю панель задач убираем, чтобы не дублировать.
 *
 *   node tools/patch-win-switcher.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');
const htmlFile = path.join(root, 'server', 'public', 'index.html');
const cssFile = path.join(root, 'server', 'public', 'extra.css');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
let html = fs.readFileSync(htmlFile, 'utf8').replace(/\r\n/g, '\n');
let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

let changed = 0;

/* ---------- 1. Контейнер в шапке ---------- */

if (!html.includes('id="winSwitcher"')) {
  const anchor = '  <div class="top-right">';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл top-right');
    process.exit(1);
  }

  html = html.replace(anchor, '  <div class="win-switcher hidden" id="winSwitcher"></div>\n\n' + anchor);
  changed++;
  console.log('index.html: диспетчер окон в шапке');
}

fs.writeFileSync(htmlFile, html);

/* ---------- 2. Рендер диспетчера ---------- */

if (!app.includes('function renderWinSwitcher')) {
  const anchor = 'function renderDeskTaskbar() {';

  const block = [
    '/** Диспетчер окон в шапке: список открытых разделов. */',
    'function renderWinSwitcher() {',
    "  const bar = $('#winSwitcher');",
    '  if (!bar) return;',
    '',
    "  const host = $('#deskWindows');",
    "  const wins = host ? [...host.querySelectorAll('.desk-window')] : [];",
    '',
    "  if (!wins.length || uiMode() !== 'desk') {",
    "    bar.classList.add('hidden');",
    "    bar.innerHTML = '';",
    '    return;',
    '  }',
    '',
    "  bar.classList.remove('hidden');",
    '',
    '  bar.innerHTML = wins.map((win) => {',
    "    const active = win.classList.contains('active') && !win.classList.contains('minimized');",
    '    const label = win.dataset.title || windowTitle(win.dataset.window);',
    '',
    '    return `<button class="win-chip ${active ? \'active\' : \'\'}" data-win-chip="${esc(win.dataset.window)}" title="${esc(label)}">',
    '      <span class="win-chip-label">${esc(label)}</span>',
    '      <span class="win-chip-x" data-win-chip-close="${esc(win.dataset.window)}">×</span>',
    '    </button>`;',
    '  }).join(\'\');',
    '',
    "  bar.querySelectorAll('[data-win-chip]').forEach((button) => {",
    "    button.addEventListener('click', (event) => {",
    '      if (event.target.dataset.winChipClose) return;',
    '',
    '      const name = button.dataset.winChip;',
    "      const win = host.querySelector('[data-window=\"' + name + '\"]');",
    '      if (!win) return;',
    '',
    '      if (win.classList.contains(\'active\') && !win.classList.contains(\'minimized\')) {',
    '        minimizeDeskWindow(name);',
    '        showDeskHome();',
    '      } else {',
    '        focusDeskWindow(name);',
    '        applyDeskLayout();',
    '      }',
    '    });',
    '  });',
    '',
    "  bar.querySelectorAll('[data-win-chip-close]').forEach((button) => {",
    "    button.addEventListener('click', (event) => {",
    '      event.stopPropagation();',
    '      closeDeskWindow(button.dataset.winChipClose);',
    '    });',
    '  });',
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block + anchor);
  changed++;
  console.log('app.js: рендер диспетчера');
}

/* ---------- 3. Диспетчер обновляется везде, где панель задач ---------- */

if (!app.includes('renderWinSwitcher();')) {
  app = app.replace(
    'function renderDeskTaskbar() {\n  renderDeskDock();',
    'function renderDeskTaskbar() {\n  renderDeskDock();\n  renderWinSwitcher();'
  );

  // если внутри renderDeskTaskbar нет renderDeskDock
  if (!app.includes('renderWinSwitcher();')) {
    app = app.replace(
      'function renderDeskTaskbar() {',
      'function renderDeskTaskbar() {\n  renderWinSwitcher();'
    );
  }

  changed++;
  console.log('app.js: диспетчер обновляется вместе с окнами');
}

/* ---------- 4. Нижняя панель больше не нужна ---------- */

if (!app.includes("bar.classList.add('hidden');\n    return;\n  }\n\n  bar.innerHTML = wins.map")) {
  // просто скрываем нижнюю панель при применении режима
  app = app.replace(
    "    if (taskbar) taskbar.classList.remove('hidden');",
    "    if (taskbar) taskbar.classList.add('hidden');"
  );
  changed++;
  console.log('app.js: нижняя панель скрыта');
}

/* ---------- 5. Шапка всегда сверху, окна под ней ---------- */

if (!app.includes('function sizeDeskLayer')) {
  const anchor = 'function applyDeskLayout() {';

  const block = [
    '/** Слой окон строго под шапкой: шапка — панель задач. */',
    'function sizeDeskLayer() {',
    "  const layer = $('#deskLayer');",
    '  if (!layer) return;',
    '',
    "  const topbar = document.querySelector('.topbar');",
    '  const height = topbar ? Math.round(topbar.getBoundingClientRect().height) : 56;',
    '',
    "  layer.style.top = height + 'px';",
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block + anchor);
  changed++;
  console.log('app.js: слой под шапкой');
}

if (!app.includes("window.addEventListener('resize', sizeDeskLayer")) {
  app = app.replace(
    "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);",
    "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);\n\n    window.addEventListener('resize', () => { if (typeof sizeDeskLayer === 'function') sizeDeskLayer(); });"
  );
  changed++;
  console.log('app.js: пересчёт слоя при изменении окна браузера');
}

fs.writeFileSync(appFile, app);

/* ---------- 6. Стили ---------- */

if (!css.includes('.win-switcher')) {
  css += `

/* ---------- Диспетчер окон в шапке ---------------------------------------- */

.topbar {
  z-index: 900;
  position: sticky;
  top: 0;
}

.win-switcher {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 240px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.win-switcher::-webkit-scrollbar { display: none; }

.win-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--ink-soft);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s, color .15s, border-color .15s;
}

.win-chip:hover { color: var(--ink); border-color: var(--blue); }

.win-chip.active {
  background: linear-gradient(180deg, #5b9bff, var(--blue));
  border-color: var(--blue);
  color: #fff;
}

.win-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.win-chip-x {
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
  opacity: .65;
}

.win-chip-x:hover { opacity: 1; }

/* Нижняя панель задач больше не показывается */
.desk-taskbar { display: none !important; }

@media (max-width: 780px) {
  .win-switcher { order: 5; flex-basis: 100%; }
  .win-chip { font-size: 12px; padding: 5px 9px; }
}
`;
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: стили диспетчера');
}

console.log('изменений:', changed);
