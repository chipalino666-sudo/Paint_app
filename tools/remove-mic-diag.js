'use strict';

/*
 * Удаляет кнопку «Проверить микрофон» и её код.
 * Голосовой ввод и подсказки про Opera/доступ остаются.
 *
 *   node tools/remove-mic-diag.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');
const htmlFile = path.join(root, 'server', 'public', 'index.html');
const cssFile = path.join(root, 'server', 'public', 'extra.css');

let app = fs.readFileSync(appFile, 'utf8');
let html = fs.readFileSync(htmlFile, 'utf8');
let css = fs.readFileSync(cssFile, 'utf8');

let changed = 0;
const before = app.length;

/* 1. Блок диагностики: от комментария перед diagLine до aiSend */
const signature = 'Проверка микрофона: разрешение, устройство, уровень, распознавание';
const signatureIndex = app.indexOf(signature);

if (signatureIndex > 0) {
  // начало блока — строка «/* ----------…» на несколько строк выше
  const blockStart = app.lastIndexOf('  /* ---', signatureIndex);
  const blockEnd = app.indexOf('  async function aiSend(text) {', signatureIndex);

  if (blockStart > 0 && blockEnd > signatureIndex) {
    const size = blockEnd - blockStart;

    // предохранитель: блок не должен быть больше 20 КБ
    if (size < 20000) {
      app = app.slice(0, blockStart) + app.slice(blockEnd);
      changed++;
      console.log('app.js: блок проверки удалён,', size, 'символов');
    } else {
      console.error('блок подозрительно большой:', size);
      process.exit(1);
    }
  }
} else {
  console.log('app.js: блок проверки не найден');
}

/* 2. Привязка кнопки */
app = app.replace(/\s*if \(\$\('#aiDiag'\)\) \$\('#aiDiag'\)\.addEventListener\('click', runMicDiag\);\r?\n/, '\n');
changed++;

/* 3. Кнопка в разметке */
const buttonRe = /\s*<button type="button" class="ai-diag" id="aiDiag">Проверить микрофон<\/button>\r?\n/;

if (buttonRe.test(html)) {
  html = html.replace(buttonRe, '\n');
  changed++;
  console.log('index.html: кнопка удалена');
} else {
  console.log('index.html: кнопки нет');
}

/* 4. Стили кнопки */
const cssRe = /\/\* Кнопка проверки микрофона \*\/[\s\S]*?\.ai-diag:disabled \{[^}]*\}\r?\n?/;

if (cssRe.test(css)) {
  css = css.replace(cssRe, '');
  changed++;
  console.log('extra.css: стили удалены');
} else {
  console.log('extra.css: стилей нет');
}

fs.writeFileSync(appFile, app);
fs.writeFileSync(htmlFile, html);
fs.writeFileSync(cssFile, css);

console.log('размер app.js:', before, '→', app.length);
console.log('изменений:', changed);
