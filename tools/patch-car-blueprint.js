'use strict';

/*
 * Схемы машины в чертёжном стиле: вид сбоку и вид сверху, оба горизонтальные.
 *
 *   node tools/patch-car-blueprint.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');
const cssFile = path.join(root, 'server', 'public', 'extra.css');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* ---------- 1. Отрисовка ---------- */

const start = app.indexOf('  function inspectionSvg(view, points, canEdit) {');
const end = app.indexOf('  function renderInspection() {');

if (start < 0 || end < 0 || end < start) {
  console.error('app.js: не нашёл inspectionSvg');
  process.exit(1);
}

const fn = [
  '  function inspectionSvg(view, points, canEdit) {',
  "    const isTop = view === 'top';",
  '',
  '    // Оба вида горизонтальные и одного размера — смотрятся как чертёж',
  '    const width = 420;',
  '    const height = 180;',
  '',
  '    const marks = points',
  '      .map((point, index) => ({ point, index }))',
  "      .filter((item) => item.point.view === view)",
  '      .map((item) => `',
  '        <g class="damage" transform="translate(${(item.point.x * width) / 100} ${(item.point.y * height) / 100})">',
  '          <circle r="9"></circle>',
  '          <text text-anchor="middle" dy="4">${item.index + 1}</text>',
  '        </g>`).join(\'\');',
  '',
  '    /* Вид сверху: капот слева, багажник справа */',
  '    const topView = `',
  '      <g class="car-top">',
  '        <!-- колёса: тонкие арки по краям -->',
  '        <path class="car-arch" d="M58 44 C72 44 82 52 82 62 L82 44"></path>',
  '        <path class="car-arch" d="M58 136 C72 136 82 128 82 118 L82 136"></path>',
  '        <path class="car-arch" d="M310 44 C324 44 334 52 334 62 L334 44"></path>',
  '        <path class="car-arch" d="M310 136 C324 136 334 128 334 118 L334 136"></path>',
  '',
  '        <!-- корпус -->',
  '        <path class="car-body" d="M28 90 C28 74 32 60 46 55 C60 50 82 47 108 45 L300 45 C336 47 366 50 384 55 C398 60 402 74 402 90 C402 106 398 120 384 125 C366 130 336 133 300 135 L108 135 C82 133 60 130 46 125 C32 120 28 106 28 90 Z"></path>',
  '',
  '        <!-- бамперы -->',
  '        <path class="car-seam" d="M46 55 C40 66 38 78 38 90 C38 102 40 114 46 125"></path>',
  '        <path class="car-seam" d="M384 55 C390 66 392 78 392 90 C392 102 390 114 384 125"></path>',
  '',
  '        <!-- капот, лобовое, крыша, заднее стекло, багажник -->',
  '        <path class="car-seam" d="M108 45 C104 62 104 118 108 135"></path>',
  '        <path class="car-seam" d="M108 45 C120 60 130 74 136 86 L136 94 C130 106 120 120 108 135"></path>',
  '        <path class="car-seam" d="M264 45 C252 60 242 74 236 86 L236 94 C242 106 252 120 264 135"></path>',
  '        <path class="car-seam" d="M300 45 C304 62 304 118 300 135"></path>',
  '',
  '        <!-- крыша -->',
  '        <path class="car-glass" d="M136 50 C168 47 232 47 264 50 L264 130 C232 133 168 133 136 130 Z"></path>',
  '',
  '        <!-- зеркала -->',
  '        <path class="car-mirror" d="M126 44 L146 34 L150 42 L130 48 Z"></path>',
  '        <path class="car-mirror" d="M126 136 L146 146 L150 138 L130 132 Z"></path>',
  '',
  '        <!-- фары и фонари -->',
  '        <path class="car-lamp" d="M40 58 C48 54 56 52 64 51 L64 61 C56 62 48 64 42 68 Z"></path>',
  '        <path class="car-lamp" d="M40 122 C48 126 56 128 64 129 L64 119 C56 118 48 116 42 112 Z"></path>',
  '        <path class="car-lamp-rear" d="M388 58 C382 54 374 52 366 51 L366 61 C374 62 382 64 386 68 Z"></path>',
  '        <path class="car-lamp-rear" d="M388 122 C382 126 374 128 366 129 L366 119 C374 118 382 116 386 112 Z"></path>',
  '',
  '        <!-- зоны -->',
  '        <rect class="zone" data-zone="передний бампер" x="26" y="45" width="26" height="90"></rect>',
  '        <rect class="zone" data-zone="капот" x="52" y="45" width="56" height="90"></rect>',
  '        <rect class="zone" data-zone="крыша" x="108" y="45" width="156" height="90"></rect>',
  '        <rect class="zone" data-zone="багажник" x="264" y="45" width="40" height="90"></rect>',
  '        <rect class="zone" data-zone="задний бампер" x="304" y="45" width="94" height="90"></rect>',
  '      </g>`;',
  '',
  '    /* Вид сбоку: перед слева */',
  '    const sideView = `',
  '      <g class="car-side">',
  '        <!-- корпус -->',
  '        <path class="car-body" d="M20 134 L20 118 C20 110 26 104 36 102 L96 96 C108 94 118 86 130 74 C143 60 160 52 178 51 L258 51 C280 51 296 59 308 72 L324 86 C332 92 342 96 352 97 L388 101 C398 103 402 110 402 118 L402 134 Z"></path>',
  '',
  '        <defs>',
  '          <clipPath id="sideBodyClip">',
  '            <path d="M20 134 L20 118 C20 110 26 104 36 102 L96 96 C108 94 118 86 130 74 C143 60 160 52 178 51 L258 51 C280 51 296 59 308 72 L324 86 C332 92 342 96 352 97 L388 101 C398 103 402 110 402 118 L402 134 Z"></path>',
  '          </clipPath>',
  '        </defs>',
  '',
  '        <!-- арки колёс -->',
  '        <g clip-path="url(#sideBodyClip)">',
  '          <circle class="car-arch-bg" cx="112" cy="134" r="32"></circle>',
  '          <circle class="car-arch-bg" cx="316" cy="134" r="32"></circle>',
  '        </g>',
  '',
  '        <path class="car-arch" d="M80 134 A32 32 0 0 1 144 134"></path>',
  '        <path class="car-arch" d="M284 134 A32 32 0 0 1 348 134"></path>',
  '',
  '        <!-- колёса -->',
  '        <circle class="car-tire" cx="112" cy="134" r="24"></circle>',
  '        <circle class="car-rim" cx="112" cy="134" r="11"></circle>',
  '        <circle class="car-tire" cx="316" cy="134" r="24"></circle>',
  '        <circle class="car-rim" cx="316" cy="134" r="11"></circle>',
  '',
  '        <!-- стёкла -->',
  '        <path class="car-glass" d="M134 78 L170 58 L208 58 L208 80 Z"></path>',
  '        <path class="car-glass" d="M218 58 L254 58 L288 80 L218 80 Z"></path>',
  '',
  '        <!-- стойки, двери, ручки, зеркало -->',
  '        <path class="car-seam" d="M210 58 L210 134"></path>',
  '        <path class="car-seam" d="M130 80 L130 100"></path>',
  '        <path class="car-seam" d="M292 80 L292 100"></path>',
  '        <rect class="car-handle" x="148" y="94" width="20" height="6" rx="3"></rect>',
  '        <rect class="car-handle" x="236" y="94" width="20" height="6" rx="3"></rect>',
  '        <path class="car-mirror" d="M124 76 L140 74 L142 82 L126 83 Z"></path>',
  '',
  '        <!-- фары и фонари -->',
  '        <path class="car-lamp" d="M20 106 C28 103 36 102 44 102 L44 114 C36 114 28 115 20 118 Z"></path>',
  '        <path class="car-lamp-rear" d="M382 103 C388 102 394 102 400 104 L400 118 C394 119 388 119 382 118 Z"></path>',
  '',
  '        <!-- зоны -->',
  '        <rect class="zone" data-zone="передний бампер" x="14" y="96" width="34" height="38"></rect>',
  '        <rect class="zone" data-zone="капот" x="48" y="88" width="72" height="22"></rect>',
  '        <rect class="zone" data-zone="передняя дверь" x="130" y="74" width="80" height="60"></rect>',
  '        <rect class="zone" data-zone="задняя дверь" x="210" y="74" width="84" height="60"></rect>',
  '        <rect class="zone" data-zone="крыша" x="176" y="51" width="82" height="27"></rect>',
  '        <rect class="zone" data-zone="заднее крыло" x="294" y="74" width="92" height="30"></rect>',
  '        <rect class="zone" data-zone="задний бампер" x="386" y="96" width="30" height="38"></rect>',
  '      </g>`;',
  '',
  '    return `',
  '      <svg class="inspect-svg${canEdit ? \' editable\' : \'\'}" data-inspect-view="${view}"',
  '           viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">',
  '        ${isTop ? topView : sideView}',
  '        ${marks}',
  '      </svg>`;',
  '  }',
  '',
  ''
].join('\n');

app = app.slice(0, start) + fn + app.slice(end);
changed++;
console.log('app.js: чертёжные схемы');

/* Вид сбоку сверху, вид сверху ниже */
const oldLayout = [
  '      <div class="inspect-layout">',
  '        <div class="inspect-scheme">',
  '          ${inspectionSvg(\'top\', points, canEdit)}',
  '          <div class="inspect-hint">вид сверху</div>',
  '        </div>',
  '        <div class="inspect-scheme">',
  '          ${inspectionSvg(\'side\', points, canEdit)}',
  '          <div class="inspect-hint">вид сбоку</div>',
  '        </div>',
  '      </div>'
].join('\n');

const newLayout = [
  '      <div class="inspect-layout">',
  '        <div class="inspect-scheme">',
  '          ${inspectionSvg(\'side\', points, canEdit)}',
  '          <div class="inspect-hint">вид сбоку</div>',
  '        </div>',
  '        <div class="inspect-scheme">',
  '          ${inspectionSvg(\'top\', points, canEdit)}',
  '          <div class="inspect-hint">вид сверху</div>',
  '        </div>',
  '      </div>'
].join('\n');

if (app.includes(oldLayout)) {
  app = app.replace(oldLayout, newLayout);
  changed++;
  console.log('app.js: сбоку сверху, сверху ниже');
}

fs.writeFileSync(appFile, app);

/* ---------- 2. Стили ---------- */

let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

const cssStart = css.indexOf('.inspect-layout {');
const cssEndMarker2 = '.car-wheel-inner { fill: none; stroke: currentColor; stroke-width: 1.4; opacity: .4; }';
const cssEnd2 = css.indexOf(cssEndMarker2);

if (cssStart >= 0 && cssEnd2 >= 0) {
  const block = [
    '.inspect-layout {',
    '  display: grid;',
    '  grid-template-columns: 1fr;',
    '  gap: 16px;',
    '  max-width: 760px;',
    '}',
    '',
    '.inspect-scheme { text-align: center; }',
    '.inspect-scheme .inspect-svg { max-width: 100%; margin: 0 auto; }',
    '',
    '.inspect-svg {',
    '  width: 100%;',
    '  height: auto;',
    '  max-height: 320px;',
    '  color: var(--ink-soft);',
    '}',
    '',
    '.inspect-svg.editable { cursor: crosshair; }',
    '',
    '/* Чертёжный стиль: светлый кузов, тонкие тёмные линии */',
    '.car-body {',
    '  fill: var(--surface);',
    '  stroke: #4a5568;',
    '  stroke-width: 1.8;',
    '  stroke-linejoin: round;',
    '}',
    '',
    '.car-glass {',
    '  fill: var(--surface-3);',
    '  stroke: #4a5568;',
    '  stroke-width: 1.3;',
    '  stroke-linejoin: round;',
    '}',
    '',
    '.car-seam {',
    '  fill: none;',
    '  stroke: #4a5568;',
    '  stroke-width: 1.2;',
    '  opacity: .75;',
    '  stroke-linecap: round;',
    '}',
    '',
    '.car-mirror {',
    '  fill: var(--surface);',
    '  stroke: #4a5568;',
    '  stroke-width: 1.3;',
    '  stroke-linejoin: round;',
    '}',
    '',
    '.car-handle { fill: #4a5568; opacity: .55; }',
    '',
    '.car-lamp { fill: #f3c343; stroke: #b98a10; stroke-width: 1; }',
    '.car-lamp-rear { fill: #e8746a; stroke: #b03f36; stroke-width: 1; }',
    '',
    '.car-tire { fill: var(--surface); stroke: #4a5568; stroke-width: 1.8; }',
    '.car-rim { fill: var(--surface); stroke: #4a5568; stroke-width: 1.4; }',
    '.car-arch { fill: none; stroke: #4a5568; stroke-width: 1.4; }',
    '.car-arch-bg { fill: var(--surface); }',
    '',
    '.car-wheel-inner { fill: none; stroke: currentColor; stroke-width: 1.4; opacity: .4; }'
  ].join('\n');

  css = css.slice(0, cssStart) + block + css.slice(cssEnd2 + cssEndMarker2.length);
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: чертёжные стили и раскладка');
}

console.log('изменений:', changed);
