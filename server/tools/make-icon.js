'use strict';

/*
 * Рисует иконку приложения (капля краски на синем фоне) и собирает .ico.
 * Без внешних библиотек: PNG кодируется вручную через zlib.
 *
 *   node tools/make-icon.js
 *
 * Результат: public/favicon.ico и ../app.ico (иконка для ярлыка на рабочем столе).
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 256;
const SS = 3; // сглаживание: считаем 3×3 подпикселя

/* ---------- Рисование ---------------------------------------------------- */

function draw() {
  const px = Buffer.alloc(SIZE * SIZE * 4);

  const radius = SIZE * 0.22;
  const drop = { cx: SIZE * 0.5, cy: SIZE * 0.60, r: SIZE * 0.205 };
  const apex = { x: SIZE * 0.5, y: SIZE * 0.235 };

  const inRoundedRect = (x, y) => {
    const r = radius;
    const left = r, right = SIZE - r, top = r, bottom = SIZE - r;

    if (x >= left && x <= right && y >= 0 && y <= SIZE) return true;
    if (y >= top && y <= bottom && x >= 0 && x <= SIZE) return true;

    const corners = [[left, top], [right, top], [left, bottom], [right, bottom]];
    return corners.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
  };

  const inDroplet = (x, y) => {
    // Круглая нижняя часть
    if ((x - drop.cx) ** 2 + (y - drop.cy) ** 2 <= drop.r ** 2) return true;

    // Треугольная верхушка, сходящаяся к острию
    const spread = drop.r * 0.92;
    const baseY = drop.cy;
    if (y > apex.y && y <= baseY) {
      const t = (y - apex.y) / (baseY - apex.y);
      const half = spread * t;
      return Math.abs(x - drop.cx) <= half;
    }
    return false;
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let bgHits = 0;
      let fgHits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px0 = x + (sx + 0.5) / SS;
          const py0 = y + (sy + 0.5) / SS;

          if (!inRoundedRect(px0, py0)) continue;
          bgHits++;
          if (inDroplet(px0, py0)) fgHits++;
        }
      }

      const total = SS * SS;
      const bgAlpha = bgHits / total;
      const index = (y * SIZE + x) * 4;

      if (bgAlpha === 0) continue;

      // Градиент фона сверху вниз: #3b82f6 → #1d4ed8
      const t = y / SIZE;
      let r = Math.round(59 + (29 - 59) * t);
      let g = Math.round(130 + (78 - 130) * t);
      let b = Math.round(246 + (216 - 246) * t);

      // Капля белая
      const fg = fgHits / total;
      if (fg > 0) {
        r = Math.round(r * (1 - fg) + 255 * fg);
        g = Math.round(g * (1 - fg) + 255 * fg);
        b = Math.round(b * (1 - fg) + 255 * fg);
      }

      px[index] = r;
      px[index + 1] = g;
      px[index + 2] = b;
      px[index + 3] = Math.round(bgAlpha * 255);
    }
  }

  return px;
}

/* ---------- PNG ---------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

function encodePng(px) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // бит на канал
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Каждая строка начинается с байта фильтра 0
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const from = y * SIZE * 4;
    const to = y * (SIZE * 4 + 1);
    raw[to] = 0;
    px.copy(raw, to + 1, from, from + SIZE * 4);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- ICO ---------------------------------------------------------- */

function encodeIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // тип: иконка
  header.writeUInt16LE(1, 4); // одна картинка

  const entry = Buffer.alloc(16);
  entry[0] = 0;   // ширина 256 кодируется нулём
  entry[1] = 0;   // высота
  entry[2] = 0;   // без палитры
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);   // плоскостей
  entry.writeUInt16LE(32, 6);  // бит на пиксель
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // смещение данных

  return Buffer.concat([header, entry, png]);
}

/* ---------- Запуск ------------------------------------------------------- */

const png = encodePng(draw());
const ico = encodeIco(png);

const publicIco = path.join(__dirname, '..', 'public', 'favicon.ico');
const rootIco = path.join(__dirname, '..', '..', 'app.ico');

fs.writeFileSync(publicIco, ico);
fs.writeFileSync(rootIco, ico);

console.log('  иконка: public/favicon.ico');
console.log('  иконка: app.ico (для ярлыка)');
console.log(`  размер: ${ico.length} байт`);
