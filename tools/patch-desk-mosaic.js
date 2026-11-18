'use strict';

/*
 * Окна на рабочем столе: показываем несколько сразу — мозаикой.
 *
 *  1. окна не сворачивают друг друга;
 *  2. автоматическая раскладка: 1 — на всё, 2 — в две колонки, 3–4 — сеткой;
 *  3. у каждого окна есть «развернуть»;
 *  4. панель задач внизу переключает и сворачивает.
 *
 *   node tools/patch-desk-mosaic.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');
const cssFile = path.join(root, 'server', 'public', 'extra.css');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

let changed = 0;

/* ---------- 1. Фокус не сворачивает соседей ---------- */

const oldFocus = [
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

const newFocus = [
  '  windowZ += 1;',
  '  win.style.zIndex = String(windowZ);',
  '',
  '  // Окна не мешают друг другу: все остаются на столе',
  "  host.querySelectorAll('.desk-window').forEach((item) => item.classList.remove('active'));",
  '',
  "  win.classList.remove('minimized');",
  "  win.classList.add('active');",
  '',
  '  applyDeskLayout();'
].join('\n');

if (app.includes(oldFocus)) {
  app = app.replace(oldFocus, newFocus);
  changed++;
  console.log('фокус больше не сворачивает другие окна');
}

/* ---------- 2. Раскладка мозаикой ---------- */

if (!app.includes('function applyDeskLayout')) {
  const anchor = 'function minimizeDeskWindow(name) {';

  const block = [
    '/** Раскладываем окна мозаикой: 1 — на всё, 2 — колонками, до 4 — сеткой. */',
    'function applyDeskLayout() {',
    "  const host = $('#deskWindows');",
    '  if (!host) return;',
    '',
    "  const visible = [...host.querySelectorAll('.desk-window')].filter((win) => !win.classList.contains('minimized'));",
    "  const maximized = visible.some((win) => win.classList.contains('is-max'));",
    '',
    '  host.classList.remove(\'count-0\', \'count-1\', \'count-2\', \'count-3\', \'count-4\');',
    '  host.classList.toggle(\'has-max\', maximized);',
    '',
    '  const many = Math.min(4, Math.max(1, visible.length));',
    "  host.classList.add('count-' + (visible.length ? many : 0));",
    '}',
    '',
    '/** Развернуть окно на всю область или вернуть в мозаику. */',
    'function toggleDeskMaximize(name) {',
    "  const host = $('#deskWindows');",
    '  if (!host) return;',
    '',
    "  const win = host.querySelector('[data-window=\"' + name + '\"]');",
    '  if (!win) return;',
    '',
    '  const wasMax = win.classList.contains(\'is-max\');',
    '',
    "  host.querySelectorAll('.desk-window').forEach((item) => item.classList.remove('is-max'));",
    '',
    '  if (!wasMax) {',
    "    win.classList.add('is-max');",
    "    win.classList.remove('minimized');",
    "    host.querySelectorAll('.desk-window').forEach((item) => item.classList.remove('active'));",
    "    win.classList.add('active');",
    '  }',
    '',
    '  applyDeskLayout();',
    '  renderDeskTaskbar();',
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block + anchor);
  changed++;
  console.log('добавлена мозаика и «развернуть»');
}

/* ---------- 3. Кнопка «развернуть» в заголовке окна ---------- */

if (!app.includes('data-win-max')) {
  app = app.replace(
    '<button class="desk-win-btn" data-win-min title="Свернуть">–</button>',
    '<button class="desk-win-btn" data-win-max title="Развернуть">⤢</button>\n          <button class="desk-win-btn" data-win-min title="Свернуть">–</button>'
  );

  app = app.replace(
    "    win.querySelector('[data-win-min]').addEventListener('click', () => minimizeDeskWindow(name));",
    "    win.querySelector('[data-win-max]').addEventListener('click', () => toggleDeskMaximize(name));\n    win.querySelector('[data-win-min]').addEventListener('click', () => minimizeDeskWindow(name));"
  );

  changed++;
  console.log('кнопка развернуть в окне');
}

/* ---------- 4. Перерисовка раскладки при изменении окон ---------- */

const oldCloseTail = [
  '  renderDeskTaskbar();',
  '  showDeskHome();',
  '}'
].join('\n');

if (app.includes(oldCloseTail)) {
  app = app.replace(oldCloseTail, '  renderDeskTaskbar();\n  applyDeskLayout();\n  showDeskHome();\n}');
  changed++;
  console.log('закрытие обновляет раскладку');
}

if (app.includes("  if (host) host.querySelectorAll('.desk-window').forEach((win) => win.classList.add('minimized'));")) {
  app = app.replace(
    "  if (host) host.querySelectorAll('.desk-window').forEach((win) => win.classList.add('minimized'));",
    "  if (host) host.querySelectorAll('.desk-window').forEach((win) => win.classList.add('minimized'));\n  applyDeskLayout();"
  );
  changed++;
  console.log('«свернуть всё» обновляет раскладку');
}

/* ---------- 5. При открытии окна тоже пересчитываем ---------- */

if (!app.includes('applyDeskLayout();\n  refreshWindowTitles();')) {
  app = app.replace(
    '  focusDeskWindow(name);\n  refreshWindowTitles();',
    '  focusDeskWindow(name);\n  applyDeskLayout();\n  refreshWindowTitles();'
  );
  changed++;
  console.log('открытие окна пересчитывает раскладку');
}

fs.writeFileSync(appFile, app);

/* ---------- 6. Стили: окна как плитки ---------- */

const oldWindowCss = [
  '/* Окно занимает всю рабочую область под шапкой */',
  '.desk-window {',
  '  position: absolute;',
  '  inset: 0;',
  '  display: flex;',
  '  flex-direction: column;',
  '  pointer-events: auto;',
  '  background: var(--surface);',
  '  border: none;',
  '  border-radius: 0;',
  '  box-shadow: none;',
  '  overflow: hidden;',
  '}'
].join('\n');

const newWindowCss = [
  '/* Окна на столе: плитки мозаики */',
  '.desk-windows {',
  '  display: grid;',
  '  gap: 10px;',
  '  padding: 10px;',
  '  height: 100%;',
  '}',
  '',
  '.desk-windows.count-1 { grid-template-columns: 1fr; grid-template-rows: 1fr; }',
  '.desk-windows.count-2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; }',
  '.desk-windows.count-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }',
  '.desk-windows.count-3 .desk-window:first-child { grid-row: span 2; }',
  '.desk-windows.count-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }',
  '',
  '.desk-window {',
  '  position: relative;',
  '  min-width: 0;',
  '  min-height: 0;',
  '  display: flex;',
  '  flex-direction: column;',
  '  pointer-events: auto;',
  '  background: var(--surface);',
  '  border: 1px solid var(--border);',
  '  border-radius: 12px;',
  '  box-shadow: var(--shadow-sm);',
  '  overflow: hidden;',
  '}',
  '',
  '.desk-window.active { border-color: color-mix(in srgb, var(--blue) 55%, var(--border)); box-shadow: 0 10px 30px rgba(37, 99, 235, .18); }',
  '',
  '.desk-windows.has-max .desk-window.is-max {',
  '  position: absolute;',
  '  inset: 10px;',
  '  z-index: 300;',
  '}',
  '',
  '.desk-windows.has-max .desk-window:not(.is-max):not(.minimized) { display: none; }'
].join('\n');

if (css.includes(oldWindowCss)) {
  css = css.replace(oldWindowCss, newWindowCss);
  changed++;
  console.log('стили: мозаика окон');
} else {
  console.log('стили окна: блок не найден, добавляю свои правила');
  css += '\n' + newWindowCss + '\n';
  changed++;
}

fs.writeFileSync(cssFile, css);
console.log('изменений:', changed);
