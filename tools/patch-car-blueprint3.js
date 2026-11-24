'use strict';

/*
 * Вид сверху: простой и симметричный, как в чертеже.
 *
 *   node tools/patch-car-blueprint3.js
 */

const fs = require('node:fs');
const path = require('node:path');

const appFile = path.join(__dirname, '..', 'server', 'public', 'app.js');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

const startMarker = '    /* Вид сверху: капот слева, багажник справа */';
const endMarker = '    /* Вид сбоку: перед слева */';

const start = app.indexOf(startMarker);
const end = app.indexOf(endMarker);

if (start < 0 || end < 0 || end < start) {
  console.error('app.js: не нашёл блок вида сверху');
  process.exit(1);
}

const top = [
  '    /* Вид сверху: капот слева, багажник справа */',
  '    const topView = `',
  '      <g class="car-top">',
  '        <!-- корпус -->',
  '        <path class="car-body" d="M56 40 L364 40 C382 44 392 62 392 90 C392 118 382 136 364 140 L56 140 C38 136 28 118 28 90 C28 62 38 44 56 40 Z"></path>',
  '',
  '        <!-- дуги колёс -->',
  '        <path class="car-arch" d="M86 40 C94 33 110 33 118 40"></path>',
  '        <path class="car-arch" d="M86 140 C94 147 110 147 118 140"></path>',
  '        <path class="car-arch" d="M302 40 C310 33 326 33 334 40"></path>',
  '        <path class="car-arch" d="M302 140 C310 147 326 147 334 140"></path>',
  '',
  '        <!-- бамперы -->',
  '        <path class="car-seam" d="M64 40 C54 56 50 72 50 90 C50 108 54 124 64 140"></path>',
  '        <path class="car-seam" d="M356 40 C366 56 370 72 370 90 C370 108 366 124 356 140"></path>',
  '',
  '        <!-- фары и фонари -->',
  '        <rect class="car-lamp" x="34" y="46" width="16" height="11" rx="4"></rect>',
  '        <rect class="car-lamp" x="34" y="123" width="16" height="11" rx="4"></rect>',
  '        <rect class="car-lamp-rear" x="370" y="46" width="16" height="11" rx="4"></rect>',
  '        <rect class="car-lamp-rear" x="370" y="123" width="16" height="11" rx="4"></rect>',
  '',
  '        <!-- капот, лобовое, крыша, заднее стекло, багажник -->',
  '        <path class="car-seam" d="M124 40 L124 140"></path>',
  '        <path class="car-glass" d="M124 40 L158 48 L158 132 L124 140 Z"></path>',
  '        <path class="car-seam" d="M158 48 L262 48 L262 132 L158 132 Z"></path>',
  '        <path class="car-glass" d="M262 48 L296 40 L296 140 L262 132 Z"></path>',
  '        <path class="car-seam" d="M296 40 L296 140"></path>',
  '',
  '        <!-- зеркала -->',
  '        <rect class="car-mirror" x="118" y="28" width="17" height="9" rx="4"></rect>',
  '        <rect class="car-mirror" x="118" y="143" width="17" height="9" rx="4"></rect>',
  '',
  '        <!-- зоны -->',
  '        <rect class="zone" data-zone="передний бампер" x="28" y="40" width="42" height="100"></rect>',
  '        <rect class="zone" data-zone="капот" x="70" y="40" width="54" height="100"></rect>',
  '        <rect class="zone" data-zone="крыша" x="124" y="40" width="172" height="100"></rect>',
  '        <rect class="zone" data-zone="багажник" x="296" y="40" width="60" height="100"></rect>',
  '        <rect class="zone" data-zone="задний бампер" x="356" y="40" width="36" height="100"></rect>',
  '      </g>`;',
  '',
  ''
].join('\n');

app = app.slice(0, start) + top + app.slice(end);

fs.writeFileSync(appFile, app);
console.log('вид сверху: чистая схема');
