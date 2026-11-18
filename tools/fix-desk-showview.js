'use strict';

/*
 * showView в режиме стола: переход внутри активного окна.
 *
 *   node tools/fix-desk-showview.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let app = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const old = [
  "    if (typeof uiMode === 'function' && uiMode() === 'desk') {",
  "      if (name === 'home') { showDeskHome(); return; }",
  '',
  '      openDeskWindow(name);',
  '      return;',
  '    }'
].join('\n');

const fresh = [
  "    if (typeof uiMode === 'function' && uiMode() === 'desk') {",
  "      if (name === 'home') { minimizeAllDeskWindows(); return; }",
  '',
  '      deskNavigate(name);',
  '      return;',
  '    }'
].join('\n');

if (app.includes(old)) {
  app = app.replace(old, () => fresh);
  console.log('showView: переход внутри окна');
} else {
  console.log('showView: блок не найден');
}

fs.writeFileSync(file, app);
