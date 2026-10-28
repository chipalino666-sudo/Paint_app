'use strict';

/*
 * Рисует простую картинку-заглушку и отправляет её в заказ и в чат,
 * чтобы можно было глазами проверить, как выглядит галерея.
 *
 *   node tools/photos-demo.js
 */

const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

const BASE = process.env.PAINT_URL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '..', 'data', 'demo-photo.png');

const W = 480;
const H = 360;

const CRC_TABLE = (() => {
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
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
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

function makePng() {
  const raw = Buffer.alloc((W * 3 + 1) * H);

  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;

    for (let x = 0; x < W; x++) {
      const i = y * (W * 3 + 1) + 1 + x * 3;
      const t = x / W;
      const s = y / H;

      raw[i] = Math.round(40 + 120 * s);          // красный
      raw[i + 1] = Math.round(90 + 90 * t);       // зелёный
      raw[i + 2] = Math.round(190 + 50 * t * s);  // синий
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

async function main() {
  const png = makePng();
  fs.writeFileSync(OUT, png);
  console.log('картинка:', (png.length / 1024).toFixed(0), 'КБ');

  const loginResponse = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin12345' })
  });

  const cookie = /psid=[^;]+/.exec(loginResponse.headers.getSetCookie().join(';'))[0];

  const orders = await (await fetch(BASE + '/api/orders', { headers: { cookie } })).json();
  const order = orders.orders[0];

  const image = 'data:image/png;base64,' + png.toString('base64');

  const photo = await (await fetch(BASE + '/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ image, orderId: order.id })
  })).json();

  console.log(`фото ${photo.photo.id} прикреплено к заказу ${order.number}`);

  const chatPhoto = await (await fetch(BASE + '/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ image, channel: `order:${order.id}` })
  })).json();

  await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ channel: `order:${order.id}`, photo_id: chatPhoto.photo.id, body: 'Вот как выглядело до работы' })
  });

  console.log('фото отправлено в обсуждение заказа');
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
