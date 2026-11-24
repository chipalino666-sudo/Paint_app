'use strict';

/*
 * Схемы машины в стиле бланка осмотра: только линии, тонкие штрихи,
 * колёса кольцами со спицами, никаких цветных пятен.
 *
 *   node tools/patch-car-form-style.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');
const cssFile = path.join(root, 'server', 'public', 'extra.css');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

const startMarker = '  function inspectionSvg(view, points, canEdit) {';
const endMarker = '  function renderInspection() {';

const start = app.indexOf(startMarker);
const end = app.indexOf(endMarker);

if (start < 0 || end < 0 || end < start) {
  console.error('app.js: не нашёл inspectionSvg');
  process.exit(1);
}

const fn = [
  '  function inspectionSvg(view, points, canEdit) {',
  "    const isTop = view === 'top';",
  '',
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
  '    /* ---------------- вид сбоку ---------------- */',
  '    const sideView = `',
  '      <g class="car-side">',
  '        <path class="car-body" d="M22 132 L22 118 C22 110 27 104 37 102 L98 96 C110 94 121 86 133 74 C146 60 163 53 181 52 L259 52 C281 52 297 60 309 73 L325 87 C333 93 343 96 353 97 L389 101 C399 103 403 110 403 118 L403 132 Z"></path>',
  '',
  '        <defs>',
  '          <clipPath id="sideBodyClip">',
  '            <path d="M22 132 L22 118 C22 110 27 104 37 102 L98 96 C110 94 121 86 133 74 C146 60 163 53 181 52 L259 52 C281 52 297 60 309 73 L325 87 C333 93 343 96 353 97 L389 101 C399 103 403 110 403 118 L403 132 Z"></path>',
  '          </clipPath>',
  '        </defs>',
  '',
  '        <!-- прорези арок: фон «вырезает» крыло -->',
  '        <g clip-path="url(#sideBodyClip)">',
  '          <circle class="car-arch-bg" cx="110" cy="132" r="33"></circle>',
  '          <circle class="car-arch-bg" cx="318" cy="132" r="33"></circle>',
  '        </g>',
  '',
  '        <path class="car-arch" d="M77 132 A33 33 0 0 1 143 132"></path>',
  '        <path class="car-arch" d="M285 132 A33 33 0 0 1 351 132"></path>',
  '',
  '        <!-- колёса: шина кольцом и диск со спицами -->',
  '        <circle class="car-tire" cx="110" cy="132" r="22"></circle>',
  '        <circle class="car-rim" cx="110" cy="132" r="10"></circle>',
  '        <path class="car-spoke" d="M110 122 L110 142 M100 132 L120 132"></path>',
  '        <circle class="car-tire" cx="318" cy="132" r="22"></circle>',
  '        <circle class="car-rim" cx="318" cy="132" r="10"></circle>',
  '        <path class="car-spoke" d="M318 122 L318 142 M308 132 L328 132"></path>',
  '',
  '        <!-- окна -->',
  '        <path class="car-glass" d="M136 79 L172 59 L209 59 L209 80 Z"></path>',
  '        <path class="car-glass" d="M219 59 L255 59 L288 80 L219 80 Z"></path>',
  '',
  '        <!-- стойки и двери -->',
  '        <path class="car-seam" d="M211 59 L211 132"></path>',
  '        <path class="car-seam" d="M131 80 L131 100"></path>',
  '        <path class="car-seam" d="M291 80 L291 100"></path>',
  '        <path class="car-seam" d="M22 132 L403 132"></path>',
  '',
  '        <!-- ручки -->',
  '        <path class="car-seam" d="M148 96 L168 96"></path>',
  '        <path class="car-seam" d="M236 96 L256 96"></path>',
  '',
  '        <!-- зеркало -->',
  '        <path class="car-mirror" d="M126 76 L142 74 L143 81 L127 83 Z"></path>',
  '',
  '        <!-- фары -->',
  '        <path class="car-lamp" d="M24 108 C30 105 36 104 42 104 L42 112 C36 112 30 113 24 116 Z"></path>',
  '        <path class="car-lamp" d="M386 104 C391 103 396 103 401 105 L401 112 C396 114 391 114 386 113 Z"></path>',
  '',
  '        <!-- зоны -->',
  '        <rect class="zone" data-zone="передний бампер" x="16" y="96" width="34" height="38"></rect>',
  '        <rect class="zone" data-zone="капот" x="50" y="86" width="74" height="22"></rect>',
  '        <rect class="zone" data-zone="передняя дверь" x="131" y="74" width="80" height="60"></rect>',
  '        <rect class="zone" data-zone="задняя дверь" x="211" y="74" width="80" height="60"></rect>',
  '        <rect class="zone" data-zone="крыша" x="176" y="52" width="82" height="28"></rect>',
  '        <rect class="zone" data-zone="заднее крыло" x="291" y="74" width="94" height="30"></rect>',
  '        <rect class="zone" data-zone="задний бампер" x="386" y="96" width="30" height="38"></rect>',
  '      </g>`;',
  '',
  '    /* ---------------- вид сверху ---------------- */',
  '    const topView = `',
  '      <g class="car-top">',
  '        <path class="car-body" d="M58 40 L362 40 C382 45 392 64 392 90 C392 116 382 135 362 140 L58 140 C38 135 28 116 28 90 C28 64 38 45 58 40 Z"></path>',
  '',
  '        <!-- дуги колёс -->',
  '        <path class="car-arch" d="M84 40 C92 32 110 32 118 40"></path>',
  '        <path class="car-arch" d="M84 140 C92 148 110 148 118 140"></path>',
  '        <path class="car-arch" d="M302 40 C310 32 328 32 336 40"></path>',
  '        <path class="car-arch" d="M302 140 C310 148 328 148 336 140"></path>',
  '',
  '        <!-- бамперы -->',
  '        <path class="car-seam" d="M66 40 C56 56 52 72 52 90 C52 108 56 124 66 140"></path>',
  '        <path class="car-seam" d="M354 40 C364 56 368 72 368 90 C368 108 364 124 354 140"></path>',
  '',
  '        <!-- фары -->',
  '        <path class="car-lamp" d="M34 58 C40 52 48 48 56 47 L56 57 C48 58 41 60 36 64 Z"></path>',
  '        <path class="car-lamp" d="M34 122 C40 128 48 132 56 133 L56 123 C48 122 41 120 36 116 Z"></path>',
  '        <path class="car-lamp" d="M386 58 C380 52 372 48 364 47 L364 57 C372 58 379 60 384 64 Z"></path>',
  '        <path class="car-lamp" d="M386 122 C380 128 372 132 364 133 L364 123 C372 122 379 120 384 116 Z"></path>',
  '',
  '        <!-- капот -->',
  '        <path class="car-seam" d="M124 40 L124 140"></path>',
  '',
  '        <!-- лобовое стекло -->',
  '        <path class="car-glass" d="M124 40 C136 48 146 56 152 64 L152 116 C146 124 136 132 124 140 Z"></path>',
  '',
  '        <!-- крыша -->',
  '        <path class="car-seam" d="M152 64 L268 64 L268 116 L152 116 Z"></path>',
  '',
  '        <!-- заднее стекло -->',
  '        <path class="car-glass" d="M268 64 C274 56 284 48 296 40 L296 140 C284 132 274 124 268 116 Z"></path>',
  '',
  '        <!-- багажник -->',
  '        <path class="car-seam" d="M296 40 L296 140"></path>',
  '',
  '        <!-- зеркала -->',
  '        <path class="car-mirror" d="M120 30 L137 30 L137 38 L120 38 Z"></path>',
  '        <path class="car-mirror" d="M120 142 L137 142 L137 150 L120 150 Z"></path>',
  '',
  '        <!-- зоны -->',
  '        <rect class="zone" data-zone="передний бампер" x="28" y="40" width="44" height="100"></rect>',
  '        <rect class="zone" data-zone="капот" x="72" y="40" width="52" height="100"></rect>',
  '        <rect class="zone" data-zone="крыша" x="124" y="40" width="172" height="100"></rect>',
  '        <rect class="zone" data-zone="багажник" x="296" y="40" width="58" height="100"></rect>',
  '        <rect class="zone" data-zone="задний бампер" x="354" y="40" width="38" height="100"></rect>',
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
fs.writeFileSync(appFile, app);
console.log('app.js: схемы в бланковом стиле');

/* ---------- Стили ---------- */

let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

const cssStart = css.indexOf('.car-body {');
const cssEndMarker = '.car-wheel-inner { fill: none; stroke: currentColor; stroke-width: 1.4; opacity: .4; }';
const cssEnd = css.indexOf(cssEndMarker);

if (cssStart >= 0 && cssEnd >= 0) {
  const block = [
    '/* Бланковый стиль: тонкие линии, без заливок */',
    '.car-body {',
    '  fill: var(--surface);',
    '  stroke: #6b5b4a;',
    '  stroke-width: 1.5;',
    '  stroke-linejoin: round;',
    '}',
    '',
    '.car-glass {',
    '  fill: color-mix(in srgb, #6b5b4a 8%, var(--surface));',
    '  stroke: #6b5b4a;',
    '  stroke-width: 1.1;',
    '  stroke-linejoin: round;',
    '}',
    '',
    '.car-seam {',
    '  fill: none;',
    '  stroke: #6b5b4a;',
    '  stroke-width: 1;',
    '  opacity: .8;',
    '  stroke-linecap: round;',
    '}',
    '',
    '.car-mirror {',
    '  fill: var(--surface);',
    '  stroke: #6b5b4a;',
    '  stroke-width: 1.1;',
    '  stroke-linejoin: round;',
    '}',
    '',
    '.car-lamp {',
    '  fill: var(--surface);',
    '  stroke: #6b5b4a;',
    '  stroke-width: 1.1;',
    '  stroke-linejoin: round;',
    '}',
    '',
    '.car-tire { fill: none; stroke: #6b5b4a; stroke-width: 6; }',
    '.car-rim { fill: var(--surface); stroke: #6b5b4a; stroke-width: 1.2; }',
    '.car-spoke { fill: none; stroke: #6b5b4a; stroke-width: 1; opacity: .8; }',
    '.car-arch { fill: none; stroke: #6b5b4a; stroke-width: 1.2; }',
    '.car-arch-bg { fill: var(--surface); }',
    '',
    '.car-wheel-inner { fill: none; stroke: currentColor; stroke-width: 1.4; opacity: .4; }'
  ].join('\n');

  css = css.slice(0, cssStart) + block + css.slice(cssEnd + cssEndMarker.length);
  fs.writeFileSync(cssFile, css);
  console.log('extra.css: бланковые стили');
}
