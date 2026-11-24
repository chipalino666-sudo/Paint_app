'use strict';

/*
 * Точные обрезки видов по фактическому рисунку:
 * сбоку — x 202..798, y 40..240; сверху — x 205..797, y 240..462.
 * Зоны пересчитаны по этим кадрам.
 *
 *   node tools/patch-car-crop-fix.js
 */

const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'server', 'public');
const appFile = path.join(publicDir, 'app.js');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

const SIDE = { x: 202, y: 40, w: 596, h: 200 };
const TOP = { x: 205, y: 240, w: 592, h: 222 };

/* ---------- 1. Рамки ---------- */

const oldSide = "{ x: 200, y: 36, w: 600, h: 205 }";
const oldTop = "{ x: 236, y: 245, w: 528, h: 210 }";

app = app.replace(oldSide, `{ x: ${SIDE.x}, y: ${SIDE.y}, w: ${SIDE.w}, h: ${SIDE.h} }`);
app = app.replace(oldTop, `{ x: ${TOP.x}, y: ${TOP.y}, w: ${TOP.w}, h: ${TOP.h} }`);

/* ---------- 2. Зоны ---------- */

const sideZones = [
  ['передний бампер', 0, 30, 62, 170],
  ['капот', 62, 20, 128, 70],
  ['крыша', 210, 0, 240, 62],
  ['передняя дверь', 190, 55, 130, 145],
  ['задняя дверь', 320, 55, 120, 145],
  ['заднее крыло', 430, 55, 120, 70],
  ['задний бампер', 545, 30, 51, 170]
];

const topZones = [
  ['передний бампер', 0, 0, 52, 222],
  ['капот', 52, 0, 98, 222],
  ['крыша', 150, 0, 250, 222],
  ['багажник', 400, 0, 120, 222],
  ['задний бампер', 520, 0, 72, 222]
];

const zoneRect = (origin, [name, x, y, w, h]) =>
  `        <rect class="zone" data-zone="${name}" x="${origin.x + x}" y="${origin.y + y}" width="${w}" height="${h}"></rect>`;

function replaceBlock(source, marker, lines) {
  const start = source.indexOf(marker);

  if (start < 0) {
    throw new Error('не нашёл блок: ' + marker);
  }

  const end = source.indexOf('`;', start);

  if (end < 0) {
    throw new Error('не нашёл конец блока: ' + marker);
  }

  return source.slice(0, start) + lines + '\n' + source.slice(end);
}

app = replaceBlock(app, '    const zonesSide = `', [
  '    const zonesSide = `',
  ...sideZones.map((zone) => zoneRect(SIDE, zone))
].join('\n'));

app = replaceBlock(app, '    const zonesTop = `', [
  '    const zonesTop = `',
  ...topZones.map((zone) => zoneRect(TOP, zone))
].join('\n'));

fs.writeFileSync(appFile, app);
console.log('обрезки и зоны обновлены:', JSON.stringify({ SIDE, TOP }));
