'use strict';

/*
 * Доводка встроенного чертежа: плотнее обрезка вида сверху,
 * пересчёт зон и более лёгкие линии.
 *
 *   node tools/patch-car-own-svg2.js
 */

const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'server', 'public');
const appFile = path.join(publicDir, 'app.js');
const cssFile = path.join(publicDir, 'extra.css');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

/* 1. Обрезка вида сверху — плотнее, без обрывков соседних видов */
app = app.replace("{ x: 226, y: 240, w: 545, h: 218 }", "{ x: 236, y: 245, w: 528, h: 210 }");

/* 2. Зоны вида сверху под новую обрезку */
const startZones = app.indexOf('    const zonesTop = `');
const endZones = app.indexOf('`;', startZones);

if (startZones < 0 || endZones < 0) {
  console.error('app.js: не нашёл zonesTop');
  process.exit(1);
}

const zones = [
  '    const zonesTop = `',
  '        <rect class="zone" data-zone="передний бампер" x="236" y="245" width="76" height="210"></rect>',
  '        <rect class="zone" data-zone="капот" x="312" y="245" width="106" height="210"></rect>',
  '        <rect class="zone" data-zone="крыша" x="418" y="245" width="208" height="210"></rect>',
  '        <rect class="zone" data-zone="багажник" x="626" y="245" width="86" height="210"></rect>',
  '        <rect class="zone" data-zone="задний бампер" x="712" y="245" width="52" height="210"></rect>',
  ''
].join('\n');

app = app.slice(0, startZones) + zones + app.slice(endZones);

fs.writeFileSync(appFile, app);
console.log('app.js: обрезка и зоны сверху обновлены');

/* 3. Линии легче и схема уже на компьютере */
let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

css = css.replace('.car-copy path {\n  fill: #59647a;\n  stroke: none;\n}', '.car-copy path {\n  fill: #8b98ad;\n  stroke: none;\n}\n\n.inspect-scheme .inspect-svg {\n  max-width: 560px;\n}');

fs.writeFileSync(cssFile, css);
console.log('extra.css: линии светлее, схема компактнее');
