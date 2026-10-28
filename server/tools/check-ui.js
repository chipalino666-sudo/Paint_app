'use strict';

/*
 * Быстрая проверка перед запуском: все ли id, к которым обращается клиент,
 * есть в разметке, и нет ли в app.js ссылок на несуществующие элементы.
 *
 *   node tools/check-ui.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const declared = new Set([
  ...[...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
  // Часть разметки рисуется из шаблонов в app.js — её id тоже считаем объявленными
  ...[...app.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1])
]);
const used = new Set([...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));

const missing = [...used].filter((id) => !declared.has(id));
const unused = [...declared].filter((id) => !used.has(id));

console.log(`id в разметке: ${declared.size}, обращений из app.js: ${used.size}`);

if (missing.length) {
  console.log('ОТСУТСТВУЮТ в разметке: ' + missing.join(', '));
} else {
  console.log('все обращения находят элемент');
}

if (unused.length) {
  console.log('объявлены, но не используются: ' + unused.join(', '));
}

process.exit(missing.length ? 1 : 0);
