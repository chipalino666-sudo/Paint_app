'use strict';

/*
 * Новые схемы машины для акта осмотра: вид сверху и вид сбоку.
 *
 *   node tools/patch-car-scheme.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');
const cssFile = path.join(root, 'server', 'public', 'extra.css');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* ---------- 1. Новая отрисовка ---------- */

const start = app.indexOf('  function inspectionSvg(view, points, canEdit) {');
const end = app.indexOf('  function renderInspection() {');

if (start < 0 || end < 0 || end < start) {
  console.error('app.js: не нашёл inspectionSvg');
  process.exit(1);
}

const fn = [
  '  function inspectionSvg(view, points, canEdit) {',
  "    const isTop = view === 'top';",
  '    const width = isTop ? 200 : 420;',
  '    const height = isTop ? 360 : 180;',
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
  '    const topView = `',
  '      <g class="car-top">',
  '        <!-- колёса видны по бокам -->',
  '        <rect class="car-tire" x="18" y="120" width="18" height="52" rx="7"></rect>',
  '        <rect class="car-tire" x="164" y="120" width="18" height="52" rx="7"></rect>',
  '        <rect class="car-tire" x="18" y="196" width="18" height="52" rx="7"></rect>',
  '        <rect class="car-tire" x="164" y="196" width="18" height="52" rx="7"></rect>',
  '',
  '        <!-- корпус -->',
  '        <path class="car-body" d="M100 20 C118 20 132 26 140 44 C148 62 152 84 154 104 L166 118 L166 236 L154 250 C152 272 146 300 136 318 C126 336 114 344 100 344 C86 344 74 336 64 318 C54 300 48 272 46 250 L34 236 L34 118 L46 104 C48 84 52 62 60 44 C68 26 82 20 100 20 Z"></path>',
  '',
  '        <!-- зеркала -->',
  '        <rect class="car-mirror" x="24" y="118" width="18" height="11" rx="5"></rect>',
  '        <rect class="car-mirror" x="158" y="118" width="18" height="11" rx="5"></rect>',
  '',
  '        <!-- линии кузова -->',
  '        <path class="car-seam" d="M60 58 C74 52 126 52 140 58"></path>',
  '        <path class="car-seam" d="M52 108 C68 102 132 102 148 108"></path>',
  '        <path class="car-seam" d="M52 256 C68 262 132 262 148 256"></path>',
  '        <path class="car-seam" d="M60 302 C74 308 126 308 140 302"></path>',
  '',
  '        <!-- лобовое, крыша, заднее стекло -->',
  '        <path class="car-glass" d="M61 110 L139 110 L130 146 L70 146 Z"></path>',
  '        <rect class="car-glass" x="70" y="146" width="60" height="72" rx="12"></rect>',
  '        <path class="car-glass" d="M70 218 L130 218 L139 254 L61 254 Z"></path>',
  '',
  '        <!-- фары и фонари -->',
  '        <rect class="car-lamp" x="64" y="28" width="22" height="11" rx="5"></rect>',
  '        <rect class="car-lamp" x="114" y="28" width="22" height="11" rx="5"></rect>',
  '        <rect class="car-lamp-rear" x="64" y="321" width="22" height="11" rx="5"></rect>',
  '        <rect class="car-lamp-rear" x="114" y="321" width="22" height="11" rx="5"></rect>',
  '',
  '        <!-- зоны -->',
  '        <rect class="zone" data-zone="передний бампер" x="62" y="20" width="76" height="42"></rect>',
  '        <rect class="zone" data-zone="капот" x="52" y="60" width="96" height="46"></rect>',
  '        <rect class="zone" data-zone="крыша" x="66" y="108" width="68" height="146"></rect>',
  '        <rect class="zone" data-zone="багажник" x="52" y="256" width="96" height="46"></rect>',
  '        <rect class="zone" data-zone="задний бампер" x="62" y="302" width="76" height="40"></rect>',
  '      </g>`;',
  '',
  '    const sideView = `',
  '      <g class="car-side">',
  '        <!-- корпус -->',
  '        <path class="car-body" d="M20 128 L20 116 C20 108 25 103 34 101 L94 95 C106 93 118 84 130 72 C142 59 158 52 176 51 L258 51 C278 51 294 59 306 71 L322 84 C330 91 340 95 350 96 L388 100 C398 102 402 109 402 118 L402 128 Z"></path>',
  '',
  '        <!-- колёса с арками -->',
  '        <circle class="car-arch" cx="112" cy="128" r="34"></circle>',
  '        <circle class="car-tire" cx="112" cy="128" r="26"></circle>',
  '        <circle class="car-rim" cx="112" cy="128" r="13"></circle>',
  '        <circle class="car-arch" cx="316" cy="128" r="34"></circle>',
  '        <circle class="car-tire" cx="316" cy="128" r="26"></circle>',
  '        <circle class="car-rim" cx="316" cy="128" r="13"></circle>',
  '',
  '        <!-- стёкла -->',
  '        <path class="car-glass" d="M134 76 L172 57 L210 57 L210 80 L130 80 Z"></path>',
  '        <path class="car-glass" d="M220 57 L256 57 L290 78 L220 80 Z"></path>',
  '',
  '        <!-- стойки, двери, ручки -->',
  '        <path class="car-seam" d="M212 57 L212 128"></path>',
  '        <path class="car-seam" d="M130 80 L130 101"></path>',
  '        <path class="car-seam" d="M294 78 L294 100"></path>',
  '        <rect class="car-handle" x="150" y="94" width="20" height="6" rx="3"></rect>',
  '        <rect class="car-handle" x="238" y="94" width="20" height="6" rx="3"></rect>',
  '        <rect class="car-mirror" x="122" y="80" width="16" height="7" rx="3"></rect>',
  '',
  '        <!-- фары и фонари -->',
  '        <rect class="car-lamp" x="20" y="104" width="17" height="11" rx="5"></rect>',
  '        <rect class="car-lamp-rear" x="383" y="101" width="19" height="11" rx="5"></rect>',
  '',
  '        <!-- зоны -->',
  '        <rect class="zone" data-zone="передний бампер" x="14" y="100" width="32" height="28"></rect>',
  '        <rect class="zone" data-zone="капот" x="36" y="84" width="66" height="20"></rect>',
  '        <rect class="zone" data-zone="передняя дверь" x="130" y="74" width="82" height="54"></rect>',
  '        <rect class="zone" data-zone="задняя дверь" x="212" y="74" width="84" height="54"></rect>',
  '        <rect class="zone" data-zone="крыша" x="176" y="51" width="82" height="26"></rect>',
  '        <rect class="zone" data-zone="заднее крыло" x="296" y="74" width="90" height="30"></rect>',
  '        <rect class="zone" data-zone="задний бампер" x="386" y="100" width="30" height="28"></rect>',
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
console.log('app.js: новые схемы машины');

fs.writeFileSync(appFile, app);

/* ---------- 2. Стили ---------- */

let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

const cssStart = css.indexOf('.car-body {');
const cssEndMarker = '.car-wheel-inner { fill: none; stroke: currentColor; stroke-width: 1.4; opacity: .4; }';
const cssEnd = css.indexOf(cssEndMarker);

if (cssStart >= 0 && cssEnd >= 0) {
  const block = [
    '.car-body {',
    '  fill: var(--surface-2);',
    '  stroke: var(--ink-soft);',
    '  stroke-width: 2;',
    '  stroke-linejoin: round;',
    '}',
    '',
    '.car-glass {',
    '  fill: color-mix(in srgb, var(--ink-soft) 14%, var(--surface));',
    '  stroke: var(--ink-soft);',
    '  stroke-width: 1.4;',
    '  stroke-linejoin: round;',
    '}',
    '',
    '.car-seam {',
    '  fill: none;',
    '  stroke: var(--ink-soft);',
    '  stroke-width: 1.3;',
    '  opacity: .45;',
    '  stroke-linecap: round;',
    '}',
    '',
    '.car-mirror {',
    '  fill: var(--surface);',
    '  stroke: var(--ink-soft);',
    '  stroke-width: 1.4;',
    '}',
    '',
    '.car-handle {',
    '  fill: var(--ink-soft);',
    '  opacity: .5;',
    '}',
    '',
    '.car-lamp { fill: #f0b429; stroke: #c98d12; stroke-width: .8; }',
    '.car-lamp-rear { fill: #e2574c; stroke: #b23a31; stroke-width: .8; }',
    '',
    '.car-tire { fill: #333d52; }',
    '.car-rim { fill: var(--surface); stroke: #333d52; stroke-width: 1.5; }',
    '/* арка: круг цветом фона «прорезает» крыло над колесом */',
    '.car-arch { fill: var(--surface); }',
    '',
    '.car-wheel-inner { fill: none; stroke: currentColor; stroke-width: 1.4; opacity: .4; }'
  ].join('\n');

  css = css.slice(0, cssStart) + block + css.slice(cssEnd + cssEndMarker.length);
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: стили новой схемы');
} else {
  console.error('extra.css: не нашёл блок стилей машины');
}

console.log('изменений:', changed);
