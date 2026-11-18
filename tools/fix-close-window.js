'use strict';

/*
 * Закрытие окна: все разделы, лежавшие внутри, возвращаются на страницу.
 *
 *   node tools/fix-close-window.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let app = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const old = [
  'function closeDeskWindow(name) {',
  "  const host = $('#deskWindows');",
  '  if (!host) return;',
  '',
  "  const win = host.querySelector('[data-window=\"' + name + '\"]');",
  '',
  '  detachWindowView(name);',
  '',
  '  if (win) win.remove();',
  '',
  '  renderDeskTaskbar();',
  '',
  '}'
].join('\n');

const fresh = [
  'function closeDeskWindow(name) {',
  "  const host = $('#deskWindows');",
  '  if (!host) return;',
  '',
  "  const win = host.querySelector('[data-window=\"' + name + '\"]');",
  '',
  '  if (win) {',
  "    win.querySelectorAll('.view').forEach((view) => detachViewFromWindows(view));",
  '    win.remove();',
  '  }',
  '',
  '  renderDeskTaskbar();',
  '  showDeskHome();',
  '}'
].join('\n');

if (!app.includes(old)) {
  console.log('closeDeskWindow: старый блок не найден');
  process.exit(1);
}

app = app.replace(old, () => fresh);
fs.writeFileSync(file, app);
console.log('closeDeskWindow обновлён');
