'use strict';

/*
 * Доводка чертёжных схем: аккуратный вид сверху, фары поменьше.
 *
 *   node tools/patch-car-blueprint2.js
 */

const fs = require('node:fs');
const path = require('node:path');

const appFile = path.join(__dirname, '..', 'server', 'public', 'app.js');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* ---------- Вид сверху перерисовываем целиком ---------- */

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
  '        <path class="car-body" d="M56 48 C70 45 88 44 108 44 L312 44 C336 45 358 48 372 54 C386 60 392 72 392 90 C392 108 386 120 372 126 C358 132 336 135 312 136 L108 136 C88 136 70 135 56 132 C44 129 38 118 38 90 C38 62 44 51 56 48 Z"></path>',
  '',
  '        <!-- бамперы -->',
  '        <path class="car-seam" d="M56 48 C48 62 46 74 46 90 C46 106 48 118 56 132"></path>',
  '        <path class="car-seam" d="M372 54 C380 66 382 78 382 90 C382 102 380 114 372 126"></path>',
  '',
  '        <!-- капот -->',
  '        <path class="car-seam" d="M108 44 C104 62 104 118 108 136"></path>',
  '',
  '        <!-- лобовое стекло -->',
  '        <path class="car-glass" d="M110 45 L152 52 L152 128 L110 135 Z"></path>',
  '',
  '        <!-- крыша -->',
  '        <path class="car-glass" d="M152 52 L268 52 L268 128 L152 128 Z"></path>',
  '',
  '        <!-- заднее стекло -->',
  '        <path class="car-glass" d="M268 52 L310 45 L310 135 L268 128 Z"></path>',
  '',
  '        <!-- багажник -->',
  '        <path class="car-seam" d="M312 44 C316 62 316 118 312 136"></path>',
  '',
  '        <!-- зеркала -->',
  '        <rect class="car-mirror" x="146" y="32" width="16" height="9" rx="4"></rect>',
  '        <rect class="car-mirror" x="146" y="139" width="16" height="9" rx="4"></rect>',
  '',
  '        <!-- колёса: небольшие выступы -->',
  '        <path class="car-arch" d="M62 46 C72 38 86 38 96 46"></path>',
  '        <path class="car-arch" d="M62 134 C72 142 86 142 96 134"></path>',
  '        <path class="car-arch" d="M312 46 C322 38 336 38 346 46"></path>',
  '        <path class="car-arch" d="M312 134 C322 142 336 142 346 134"></path>',
  '',
  '        <!-- фары и фонари -->',
  '        <path class="car-lamp" d="M44 54 C50 51 56 49 62 48 L62 58 C56 59 50 61 46 64 Z"></path>',
  '        <path class="car-lamp" d="M44 126 C50 129 56 131 62 132 L62 122 C56 121 50 119 46 116 Z"></path>',
  '        <path class="car-lamp-rear" d="M384 56 C378 53 372 51 366 50 L366 60 C372 61 378 63 382 66 Z"></path>',
  '        <path class="car-lamp-rear" d="M384 124 C378 127 372 129 366 130 L366 120 C372 119 378 117 382 114 Z"></path>',
  '',
  '        <!-- зоны -->',
  '        <rect class="zone" data-zone="передний бампер" x="38" y="44" width="30" height="92"></rect>',
  '        <rect class="zone" data-zone="капот" x="68" y="44" width="42" height="92"></rect>',
  '        <rect class="zone" data-zone="крыша" x="110" y="44" width="202" height="92"></rect>',
  '        <rect class="zone" data-zone="багажник" x="312" y="44" width="60" height="92"></rect>',
  '        <rect class="zone" data-zone="задний бампер" x="372" y="44" width="20" height="92"></rect>',
  '      </g>`;',
  '',
  ''
].join('\n');

app = app.slice(0, start) + top + app.slice(end);
changed++;
console.log('вид сверху перерисован');

/* ---------- Фары сбоку — поменьше ---------- */

const oldFront = '<path class="car-lamp" d="M20 106 C28 103 36 102 44 102 L44 114 C36 114 28 115 20 118 Z"></path>';
const newFront = '<path class="car-lamp" d="M22 108 C28 105 35 104 42 104 L42 113 C35 113 28 114 22 117 Z"></path>';

if (app.includes(oldFront)) {
  app = app.replace(oldFront, newFront);
  changed++;
  console.log('фара сбоку уменьшена');
}

const oldRear = '<path class="car-lamp-rear" d="M382 103 C388 102 394 102 400 104 L400 118 C394 119 388 119 382 118 Z"></path>';
const newRear = '<path class="car-lamp-rear" d="M384 104 C390 103 396 103 400 105 L400 116 C396 118 390 118 384 117 Z"></path>';

if (app.includes(oldRear)) {
  app = app.replace(oldRear, newRear);
  changed++;
  console.log('фонарь сбоку уменьшен');
}

fs.writeFileSync(appFile, app);
console.log('изменений:', changed);
