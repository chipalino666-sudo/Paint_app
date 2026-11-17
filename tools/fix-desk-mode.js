'use strict';

/*
 * Правки режима «рабочий стол»:
 *  1. закрытое окно можно открыть снова (вьюха возвращается в main);
 *  2. кнопка «Стол» видна только в режиме рабочего стола.
 *
 *   node tools/fix-desk-mode.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let app = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* 1. detach */
const oldDetach = [
  '  if (view && main && view.parentElement && !main.contains(view)) {',
  '    main.appendChild(view);',
  "    view.classList.add('hidden');",
  '  }'
].join('\n');

const newDetach = [
  '  if (view && main && view.parentElement !== main) {',
  '    main.appendChild(view);',
  "    view.classList.add('hidden');",
  '  }'
].join('\n');

if (app.includes(oldDetach)) {
  app = app.replace(oldDetach, newDetach);
  changed++;
  console.log('detach: возвращает вьюху в main');
}

/* 2. кнопка «Стол» только в режиме стола */
const anchor = "  document.body.classList.toggle('ui-desk', desk);";

if (app.includes(anchor) && !app.includes('data-view="home"')) {
  const extra = [
    anchor,
    '',
    "  // Кнопка «Стол» нужна только в режиме рабочего стола",
    "  document.querySelectorAll('[data-view=\"home\"]').forEach((button) => {",
    "    button.classList.toggle('hidden', !desk);",
    '  });'
  ].join('\n');

  app = app.replace(anchor, extra);
  changed++;
  console.log('кнопка «Стол» скрывается в обычном режиме');
}

fs.writeFileSync(file, app);
console.log('изменений:', changed);
