'use strict';

/*
 * Доводка схемы машины: колёса на места осей, аккуратные арки и порог,
 * зеркало на своём месте.
 *
 *   node tools/patch-car-scheme2.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let app = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* 1. Колёса вида сверху — на переднюю и заднюю ось */
const wheels = [
  ['<rect class="car-tire" x="18" y="120" width="18" height="52" rx="7"></rect>',
   '<rect class="car-tire" x="18" y="84" width="18" height="52" rx="7"></rect>'],
  ['<rect class="car-tire" x="164" y="120" width="18" height="52" rx="7"></rect>',
   '<rect class="car-tire" x="164" y="84" width="18" height="52" rx="7"></rect>'],
  ['<rect class="car-tire" x="18" y="196" width="18" height="52" rx="7"></rect>',
   '<rect class="car-tire" x="18" y="218" width="18" height="52" rx="7"></rect>'],
  ['<rect class="car-tire" x="164" y="196" width="18" height="52" rx="7"></rect>',
   '<rect class="car-tire" x="164" y="218" width="18" height="52" rx="7"></rect>']
];

for (const [from, to] of wheels) {
  if (app.includes(from)) {
    app = app.replace(from, to);
    changed++;
  }
}

/* 2. Колёса вида сбоку: арки только внутри крыла, порог поверх */
const oldWheels = [
  '        <!-- колёса с арками -->',
  '        <circle class="car-arch" cx="112" cy="128" r="34"></circle>',
  '        <circle class="car-tire" cx="112" cy="128" r="26"></circle>',
  '        <circle class="car-rim" cx="112" cy="128" r="13"></circle>',
  '        <circle class="car-arch" cx="316" cy="128" r="34"></circle>',
  '        <circle class="car-tire" cx="316" cy="128" r="26"></circle>',
  '        <circle class="car-rim" cx="316" cy="128" r="13"></circle>'
].join('\n');

const newWheels = [
  '        <!-- колёса: арки прорезают крыло, порог проходит поверх -->',
  '        <defs>',
  '          <clipPath id="sideBodyClip">',
  '            <path d="M20 128 L20 116 C20 108 25 103 34 101 L94 95 C106 93 118 84 130 72 C142 59 158 52 176 51 L258 51 C278 51 294 59 306 71 L322 84 C330 91 340 95 350 96 L388 100 C398 102 402 109 402 118 L402 128 Z"></path>',
  '          </clipPath>',
  '        </defs>',
  '',
  '        <g clip-path="url(#sideBodyClip)">',
  '          <circle class="car-arch" cx="112" cy="128" r="34"></circle>',
  '          <circle class="car-arch" cx="316" cy="128" r="34"></circle>',
  '        </g>',
  '',
  '        <circle class="car-tire" cx="112" cy="128" r="25"></circle>',
  '        <circle class="car-rim" cx="112" cy="128" r="12"></circle>',
  '        <circle class="car-tire" cx="316" cy="128" r="25"></circle>',
  '        <circle class="car-rim" cx="316" cy="128" r="12"></circle>',
  '',
  '        <path class="car-seam" d="M26 128 L398 128"></path>'
].join('\n');

if (app.includes(oldWheels)) {
  app = app.replace(oldWheels, newWheels);
  changed++;
  console.log('боковой вид: арки, колёса и порог');
}

/* 3. Зеркало бокового вида */
if (app.includes('<rect class="car-mirror" x="122" y="80" width="16" height="7" rx="3"></rect>')) {
  app = app.replace(
    '<rect class="car-mirror" x="122" y="80" width="16" height="7" rx="3"></rect>',
    '<rect class="car-mirror" x="124" y="76" width="15" height="6" rx="3"></rect>'
  );
  changed++;
  console.log('зеркало переставлено');
}

fs.writeFileSync(file, app);
console.log('изменений:', changed);
