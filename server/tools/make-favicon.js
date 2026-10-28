'use strict';

/*
 * Собирает favicon.ico из готовой квадратной иконки (колесо).
 * Внутри — PNG разных размеров, чтобы значок был чётким и в шапке, и на вкладке.
 *
 *   node tools/make-favicon.js
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SOURCE = path.join(__dirname, '..', 'public', 'icon-512.png');
const TARGET = path.join(__dirname, '..', 'public', 'favicon.ico');
const SIZES = [16, 32, 48, 64, 128];

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

  return { width, height, bpp, pixels };
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

const crc32 = (buffer) => {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

function encodePng(pixels, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);

  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- уменьшение ---------------------------------------------------- */

function resize(source, target) {
  const { width, height, bpp, pixels } = source;
  const out = Buffer.alloc(target * target * 4);
  const ratio = width / target;

  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;

      const y0 = Math.floor(y * ratio);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
      const x0 = Math.floor(x * ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));

      for (let sy = y0; sy < y1 && sy < height; sy++) {
        for (let sx = x0; sx < x1 && sx < width; sx++) {
          const i = (sy * width + sx) * bpp;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          a += bpp === 4 ? pixels[i + 3] : 255;
          count++;
        }
      }

      const o = (y * target + x) * 4;
      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = Math.round(a / count);
    }
  }

  return out;
}

/* ---------- сборка .ico --------------------------------------------------- */

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);

    entries.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/* ---------- запуск -------------------------------------------------------- */

function main() {
  const source = readPng(SOURCE);
  const images = SIZES.map((size) => ({ size, data: encodePng(resize(source, size), size) }));

  fs.writeFileSync(TARGET, buildIco(images));

  const kb = (fs.statSync(TARGET).size / 1024).toFixed(1);
  console.log(`favicon.ico собран из колеса: ${SIZES.join(', ')} px, ${kb} КБ`);
}

main();
