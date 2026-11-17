'use strict';

/*
 * Режим «рабочий стол», шаг 2: логика окон + подключение к showView.
 *
 *   node tools/patch-desk-mode2.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* ---------- 1. Логика окон ---------- */

if (!app.includes('function openDeskWindow')) {
  const anchor = 'async function openOrder(id) {';

  if (!app.includes(anchor)) {
    console.error('не нашёл openOrder');
    process.exit(1);
  }

  const block = fs.readFileSync(path.join(__dirname, 'desk-mode.txt'), 'utf8').replace(/\r?\n/g, '\n');

  app = app.replace(anchor, () => block + '\n' + anchor);
  changed++;
  console.log('логика окон добавлена');
}

/* ---------- 2. showView: в режиме стола открываем окна ---------- */

const showViewLine = '  function showView(name) {';

if (!app.includes("openDeskWindow(name);\n        return;")) {
  if (!app.includes(showViewLine)) {
    console.error('не нашёл showView');
    process.exit(1);
  }

  app = app.replace(showViewLine, [
    showViewLine,
    '    // В режиме рабочего стола разделы открываются окнами, а не подменяют экран',
    "    if (typeof uiMode === 'function' && uiMode() === 'desk') {",
    "      if (name === 'home') { showDeskHome(); return; }",
    '',
    '      openDeskWindow(name);',
    '      return;',
    '    }'
  ].join('\n'));

  changed++;
  console.log('showView перенаправляет в окна');
}

/* ---------- 3. Заголовок окна заказа ---------- */

if (!app.includes('refreshWindowTitles();')) {
  app = app.replace(
    "      showView('order');",
    "      showView('order');\n      refreshWindowTitles();"
  );
  changed++;
  console.log('обновление заголовков окон');
}

/* ---------- 4. Пуск: применяем сохранённый режим ---------- */

if (!app.includes('applyUiMode();')) {
  app = app.replace(
    "    showView('home');\n      loadDesk();",
    '    applyUiMode();'
  );

  app = app.replace(
    "      showView('home');\n    loadDesk();",
    '    applyUiMode();'
  );

  changed++;
  console.log('пуск через applyUiMode');
}

/* ---------- 5. Переключатель в меню пользователя ---------- */

if (!app.includes("$('#btnUiMode')")) {
  app = app.replace(
    "    if ($('#btnPassword')) $('#btnPassword').addEventListener('click', openPasswordModal);",
    [
      "    if ($('#btnPassword')) $('#btnPassword').addEventListener('click', openPasswordModal);",
      '',
      "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);"
    ].join('\n')
  );

  changed++;
  console.log('переключатель режима подключён');
}

fs.writeFileSync(appFile, app);
console.log('изменений:', changed);
