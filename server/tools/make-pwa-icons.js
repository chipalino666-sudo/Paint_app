'use strict';

/*
 * Делает квадратные иконки приложения (192 и 512) из логотипа:
 * берёт колесо вместо буквы «О» и кладёт его на белый скруглённый квадрат.
 *
 *   node tools/make-pwa-icons.js
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SOURCE = path.join(__dirname, '..', 'public', 'logo.png');

/* ---------- PNG: чтение --------------------------------------------------- */

function readPng(file) {
  const buffer = fs.readFileSync(file);
  let offset = 8;
  const idat = [];
  let ihdr = null;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);

    offset += 12 + length;
  }

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const colorType = ihdr[9];
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = Buffer.alloc(stride * height);

  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const to = y * stride;

    for (let x = 0; x < stride; x++) {
      const value = raw[from + x];
      const left = x >= bpp ? pixels[to + x - bpp] : 0;
      const up = y > 0 ? pixels[to - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[to - stride + x - bpp] : 0;

      let result;
      switch (filter) {
        case 0: result = value; break;
        case 1: result = value + left; break;
        case 2: result = value + up; break;
        case 3: result = value + ((left + up) >> 1); break;
        case 4: result = value + paeth(left, up, upLeft); break;
        default: throw new Error('фильтр ' + filter);
      }

      pixels[to + x] = result & 0xff;
    }
  }

  return { width, height, bpp, colorType, pixels };
}

/* ---------- PNG: запись --------------------------------------------------- */

const CRC = (() => {
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
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC[(crc ^ buffer[i]) & 0xff];
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

function writePng(file, pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]));
}

/* ---------- сборка иконки ------------------------------------------------- */

function main() {
  const img = readPng(SOURCE);
  const { width, height, bpp, pixels } = img;

  // Ищем колесо: тёмно-синие пиксели
  let minX = width, minY = height, maxX = -1, maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * bpp;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = bpp === 4 ? pixels[i + 3] : 255;

      if (a > 40 && b > 90 && r < 90 && g < 90) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) throw new Error('не нашёл колесо в логотипе');

  const wheelW = maxX - minX + 1;
  const wheelH = maxY - minY + 1;
  console.log(`  колесо: ${wheelW}x${wheelH} в точке ${minX},${minY}`);

  const SIZE = 512;
  const canvas = Buffer.alloc(SIZE * SIZE * 4);

  // Белый скруглённый квадрат
  const radius = SIZE * 0.22;

  const insideRounded = (x, y) => {
    if (x >= radius && x <= SIZE - radius) return true;
    if (y >= radius && y <= SIZE - radius) return true;

    const corners = [[radius, radius], [SIZE - radius, radius], [radius, SIZE - radius], [SIZE - radius, SIZE - radius]];
    return corners.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius);
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (!insideRounded(x + 0.5, y + 0.5)) continue;
      canvas[i] = 255; canvas[i + 1] = 255; canvas[i + 2] = 255; canvas[i + 3] = 255;
    }
  }

  // Колесо по центру, занимает 62% ширины
  const target = SIZE * 0.62;
  const scale = target / Math.max(wheelW, wheelH);
  const drawW = wheelW * scale;
  const drawH = wheelH * scale;
  const offsetX = (SIZE - drawW) / 2;
  const offsetY = (SIZE - drawH) / 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = minX + (x - offsetX) / scale;
      const sy = minY + (y - offsetY) / scale;

      if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;

      // Ближайший пиксель исходника
      const px = Math.min(width - 1, Math.max(0, Math.round(sx)));
      const py = Math.min(height - 1, Math.max(0, Math.round(sy)));
      const si = (py * width + px) * bpp;
      const alpha = bpp === 4 ? pixels[si + 3] : 255;

      if (alpha < 40) continue;

      const di = (y * SIZE + x) * 4;
      canvas[di] = pixels[si];
      canvas[di + 1] = pixels[si + 1];
      canvas[di + 2] = pixels[si + 2];
      canvas[di + 3] = 255;
    }
  }

  writePng(path.join(__dirname, '..', 'public', 'icon-512.png'), canvas, SIZE);

  // Уменьшаем до 192 простым усреднением 2.67 → берём по сетке
  const small = 192;
  const smallPixels = Buffer.alloc(small * small * 4);
  const ratio = SIZE / small;

  for (let y = 0; y < small; y++) {
    for (let x = 0; x < small; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;

      for (let sy = Math.floor(y * ratio); sy < Math.floor((y + 1) * ratio); sy++) {
        for (let sx = Math.floor(x * ratio); sx < Math.floor((x + 1) * ratio); sx++) {
          const si = (sy * SIZE + sx) * 4;
          r += canvas[si]; g += canvas[si + 1]; b += canvas[si + 2]; a += canvas[si + 3];
          count++;
        }
      }

      const di = (y * small + x) * 4;
      smallPixels[di] = Math.round(r / count);
      smallPixels[di + 1] = Math.round(g / count);
      smallPixels[di + 2] = Math.round(b / count);
      smallPixels[di + 3] = Math.round(a / count);
    }
  }

  writePng(path.join(__dirname, '..', 'public', 'icon-192.png'), smallPixels, small);

  console.log('  готово: icon-512.png, icon-192.png');
}

main();
