'use strict';

/*
 * Встраивает присланный SVG с машиной в акт осмотра.
 *
 *   node tools/patch-car-own-svg.js
 *
 * Путь выносится в /car-scheme.js (чтобы не раздувать app.js),
 * виды сбоку и сверху — обрезки одного рисунка, поверх них зоны отметок.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'server', 'public');
const srcFile = 'C:\\Users\\Maks\\Downloads\\aaa25df4eb3652974c8e613c2f6f0fea.svg';

/* ---------- 1. Данные рисунка ---------- */

const raw = fs.readFileSync(srcFile, 'utf8');
const match = /<path[^>]*\sd="([^"]+)"/.exec(raw);

if (!match) {
  console.error('в файле не найден path с атрибутом d');
  process.exit(1);
}

const d = match[1];
fs.writeFileSync(path.join(publicDir, 'car-scheme.js'), 'window.CAR_SCHEME_PATH = "' + d + '";\n');
console.log('car-scheme.js:', Math.round(d.length / 1024), 'КБ пути');

/* ---------- 2. Подключаем скрипт ---------- */

const indexPath = path.join(publicDir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

if (!html.includes('/car-scheme.js')) {
  html = html.replace('<script src="/app.js"></script>', '<script src="/car-scheme.js"></script>\n<script src="/app.js"></script>');
  fs.writeFileSync(indexPath, html);
  console.log('index.html: подключён car-scheme.js');
}

/* ---------- 3. Отрисовка ---------- */

const appFile = path.join(publicDir, 'app.js');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

const startMarker = '  function inspectionSvg(view, points, canEdit) {';
const endMarker = '  function renderInspection() {';

const start = app.indexOf(startMarker);
const end = app.indexOf(endMarker);

if (start < 0 || end < 0 || end < start) {
  console.error('app.js: не нашёл inspectionSvg');
  process.exit(1);
}

/* Обрезки рисунка: левый верхний угол и размеры */
const SIDE = { x: 200, y: 36, w: 600, h: 205 };
const TOP = { x: 226, y: 240, w: 545, h: 218 };

/* Зоны в координатах обрезки */
const zonesSide = [
  ['передний бампер', 2, 96, 60, 109],
  ['капот', 62, 58, 128, 66],
  ['крыша', 250, 18, 220, 44],
  ['передняя дверь', 190, 58, 140, 130],
  ['задняя дверь', 330, 58, 120, 130],
  ['заднее крыло', 450, 58, 110, 66],
  ['задний бампер', 560, 96, 40, 109]
];

const zonesTop = [
  ['передний бампер', 0, 2, 82, 214],
  ['капот', 82, 2, 108, 214],
  ['крыша', 190, 2, 210, 214],
  ['багажник', 400, 2, 92, 214],
  ['задний бампер', 492, 2, 53, 214]
];

const zoneLine = (offsetX, offsetY) => ([name, x, y, w, h]) =>
  `        <rect class="zone" data-zone="${name}" x="${offsetX + x}" y="${offsetY + y}" width="${w}" height="${h}"></rect>`;

const fn = [
  '  function inspectionSvg(view, points, canEdit) {',
  "    const isTop = view === 'top';",
  '',
  '    // Один рисунок, два вида: сбоку и сверху',
  "    const frame = isTop",
  `      ? { x: ${TOP.x}, y: ${TOP.y}, w: ${TOP.w}, h: ${TOP.h} }`,
  `      : { x: ${SIDE.x}, y: ${SIDE.y}, w: ${SIDE.w}, h: ${SIDE.h} };`,
  '',
  '    const marks = points',
  '      .map((point, index) => ({ point, index }))',
  "      .filter((item) => item.point.view === view)",
  '      .map((item) => {',
  '        const x = frame.x + (item.point.x * frame.w) / 100;',
  '        const y = frame.y + (item.point.y * frame.h) / 100;',
  '',
  '        return `',
  '        <g class="damage" transform="translate(${x} ${y})">',
  '          <circle r="9"></circle>',
  '          <text text-anchor="middle" dy="4">${item.index + 1}</text>',
  '        </g>`;',
  "      }).join('');",
  '',
  `    const zonesSide = \``,
  ...zonesSide.map(zoneLine(SIDE.x, SIDE.y)),
  '`;',
  '',
  `    const zonesTop = \``,
  ...zonesTop.map(zoneLine(TOP.x, TOP.y)),
  '`;',
  '',
  '    return `',
  '      <svg class="inspect-svg${canEdit ? \' editable\' : \'\'}" data-inspect-view="${view}"',
  '           viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}" preserveAspectRatio="xMidYMid meet">',
  '        <g class="car-copy"><path d="${window.CAR_SCHEME_PATH || \'\'}"></path></g>',
  '        ${isTop ? zonesTop : zonesSide}',
  '        ${marks}',
  '      </svg>`;',
  '  }',
  '',
  ''
].join('\n');

app = app.slice(0, start) + fn + app.slice(end);
fs.writeFileSync(appFile, app);
console.log('app.js: схемы из присланного чертежа');
