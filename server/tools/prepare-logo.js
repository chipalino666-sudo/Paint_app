'use strict';

/*
 * Готовит логотип для сайта: обрезает белые поля и сохраняет аккуратный PNG.
 * Без внешних библиотек — PNG читается и пишется вручную.
 *
 *   node tools/prepare-logo.js
 *
 * На входе  public/logo-source.png
 * На выходе public/logo.png
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SOURCE = path.join(__dirname, '..', 'public', 'logo-source.png');
const TARGET = path.join(__dirname, '..', 'public', 'logo.png');

const PADDING = 10;      // отступ вокруг логотипа
const WHITE_LIMIT = 245; // что считаем белым фоном

/* ---------- чтение PNG ---------------------------------------------------- */

function readChunks(buffer) {
  const chunks = {};
  let offset = 8;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR' || type === 'IDAT') {
      chunks[type] = chunks[type] ? Buffer.concat([chunks[type], data]) : data;
    }

    offset += 12 + length;
  }

  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    const prevStart = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const value = raw[rowStart + x];
      const left = x >= bytesPerPixel ? out[outStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0;

      let result;
      switch (filter) {
        case 0: result = value; break;
        case 1: result = value + left; break;
        case 2: result = value + up; break;
        case 3: result = value + ((left + up) >> 1); break;
        case 4: result = value + paeth(left, up, upLeft); break;
        default: throw new Error('Неизвестный фильтр PNG: ' + filter);
      }

      out[outStart + x] = result & 0xff;
    }
  }

  return out;
}

/* ---------- запись PNG ---------------------------------------------------- */

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
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
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

function encodePng(pixels, width, height, bytesPerPixel, colorType) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- обрезка ------------------------------------------------------- */

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Нет файла ' + SOURCE);
    process.exit(1);
  }

  const chunks = readChunks(fs.readFileSync(SOURCE));
  const ihdr = chunks.IHDR;

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const colorType = ihdr[9];

  if (ihdr[8] !== 8 || ihdr[12] !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Неподдерживаемый PNG: глубина ${ihdr[8]}, тип ${colorType}, interlace ${ihdr[12]}`);
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const pixels = unfilter(zlib.inflateSync(chunks.IDAT), width, height, bytesPerPixel);

  const isWhite = (x, y) => {
    const index = (y * width + x) * bytesPerPixel;
    if (colorType === 6 && pixels[index + 3] < 10) return true;
    return pixels[index] >= WHITE_LIMIT
      && pixels[index + 1] >= WHITE_LIMIT
      && pixels[index + 2] >= WHITE_LIMIT;
  };

  let minX = width, minY = height, maxX = -1, maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isWhite(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) {
    console.error('Картинка целиком белая — нечего обрезать');
    process.exit(1);
  }

  minX = Math.max(0, minX - PADDING);
  minY = Math.max(0, minY - PADDING);
  maxX = Math.min(width - 1, maxX + PADDING);
  maxY = Math.min(height - 1, maxY + PADDING);

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;

  // Обрезаем и переводим в RGBA — так логотип ляжет на любой фон
  const cropped = Buffer.alloc(cropWidth * cropHeight * 4);

  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const from = ((minY + y) * width + (minX + x)) * bytesPerPixel;
      const to = (y * cropWidth + x) * 4;

      const r = pixels[from];
      const g = pixels[from + 1];
      const b = pixels[from + 2];
      const a = colorType === 6 ? pixels[from + 3] : 255;

      // Белый фон делаем прозрачным, чтобы логотип лёг на любой цвет
      const whiteness = Math.min(r, g, b);
      const alpha = whiteness >= WHITE_LIMIT ? 0 : 255;

      cropped[to] = r;
      cropped[to + 1] = g;
      cropped[to + 2] = b;
      cropped[to + 3] = Math.min(a, alpha);
    }
  }

  fs.writeFileSync(TARGET, encodePng(cropped, cropWidth, cropHeight, 4, 6));

  console.log(`  было: ${width}x${height}`);
  console.log(`  стало: ${cropWidth}x${cropHeight}`);
  console.log('  сохранено: public/logo.png');
}

main();
