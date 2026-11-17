'use strict';

/*
 * Часы в шапке, переключатель режима в шапке и синхронизация состояний.
 *
 *   node tools/patch-topbar.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let app = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* 1. Функции часов и переключателя */
if (!app.includes('function tickClock')) {
  const anchor = 'function uiMode() {';

  const block = [
    '/** Часы в шапке: время видно и в полноэкранном режиме. */',
    'function tickClock() {',
    "  const host = $('#topClock');",
    '  if (!host) return;',
    '',
    '  const now = new Date();',
    "  host.textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });",
    "  host.title = now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', weekday: 'short' });",
    '}',
    '',
    'function startClock() {',
    '  tickClock();',
    '  setInterval(tickClock, 15000);',
    '}',
    '',
    '/** Переключатель режима в шапке: обычный / рабочий стол. */',
    'function renderModeSwitch() {',
    "  const buttons = $$('#btnModeSwitch .mode-seg');",
    '  const mode = uiMode();',
    '',
    '  buttons.forEach((button) => {',
    "    button.classList.toggle('active', button.dataset.mode === mode);",
    '  });',
    '}',
    '',
    'function setUiMode(mode) {',
    '  localStorage.setItem(UI_MODE_KEY, mode);',
    '  applyUiMode();',
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block);
  changed++;
  console.log('часы и переключатель добавлены');
}

/* 2. Состояние переключателя обновляется вместе с режимом */
const labelAnchor = 'function uiModeLabel() {';

if (app.includes("  uiModeLabel();\n}") && !app.includes('renderModeSwitch();')) {
  app = app.replace('  uiModeLabel();\n}', '  uiModeLabel();\n  renderModeSwitch();\n}');
  changed++;
  console.log('applyUiMode обновляет переключатель');
}

/* 3. Запуск часов и клики по переключателю */
if (!app.includes('startClock();')) {
  app = app.replace(
    "      pushAppState();\n\n      applyUiMode();",
    "      pushAppState();\n\n      applyUiMode();\n      startClock();"
  );

  app = app.replace(
    "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);",
    [
      "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);",
      '',
      '    /* Переключатель режима в шапке */',
      "    $$('#btnModeSwitch .mode-seg').forEach((button) => {",
      "      button.addEventListener('click', () => setUiMode(button.dataset.mode));",
      '    });'
    ].join('\n')
  );

  changed++;
  console.log('запуск часов и обработчики переключателя');
}

fs.writeFileSync(file, app);
console.log('изменений:', changed);
