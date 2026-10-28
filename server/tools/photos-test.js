'use strict';

/*
 * Проверка фотографий: загрузка к заказу, в чат заказа и в общий чат,
 * плюс проверка, что чужой сотрудник снимок не получит.
 *
 *   node tools/photos-test.js
 */

const BASE = process.env.PAINT_URL || 'http://127.0.0.1:3000';

// 1×1 PNG — достаточно, чтобы проверить весь путь
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function login(login, password) {
  const response = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });

  const raw = response.headers.getSetCookie().join(';');
  return /psid=[^;]+/.exec(raw)[0];
}

async function call(method, path, cookie, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json = null;

  try { json = JSON.parse(text); } catch (e) { /* не JSON */ }

  return { status: response.status, json, text };
}

async function main() {
  const admin = await login('admin', 'admin12345');
  const orders = await call('GET', '/api/orders', admin);
  const orderId = orders.json.orders[0].id;

  console.log(`Заказ для проверки: ${orders.json.orders[0].number}`);

  // 1. Фото к заказу
  const created = await call('POST', '/api/photos', admin, {
    image: 'data:image/png;base64,' + TINY_PNG,
    orderId
  });

  console.log('1) фото к заказу:', created.status === 200 ? `ok, id ${created.json.photo.id}` : `ОШИБКА ${created.status} ${created.text}`);
  const photoId = created.json && created.json.photo ? created.json.photo.id : null;

  // 2. Список фото заказа
  const list = await call('GET', `/api/orders/${orderId}/photos`, admin);
  console.log('2) список фото заказа:', list.status === 200 ? `${list.json.photos.length} шт.` : `ОШИБКА ${list.status}`);

  // 3. Сам файл отдаётся
  const file = await fetch(BASE + `/api/photos/${photoId}`, { headers: { cookie: admin } });
  console.log('3) файл по ссылке:', file.status === 200 ? `${file.headers.get('content-type')}, ${(await file.arrayBuffer()).byteLength} байт` : `ОШИБКА ${file.status}`);

  // 4. Фото в чат заказа
  const chatPhoto = await call('POST', '/api/photos', admin, {
    image: 'data:image/png;base64,' + TINY_PNG,
    channel: `order:${orderId}`
  });

  const message = await call('POST', '/api/chat', admin, {
    channel: `order:${orderId}`,
    photo_id: chatPhoto.json.photo.id
  });

  console.log('4) фото в чат заказа:', message.status === 200 && message.json.message.photo_url ? message.json.message.photo_url : `ОШИБКА ${message.status}`);

  // 5. Фото в общий чат
  const generalPhoto = await call('POST', '/api/photos', admin, {
    image: 'data:image/png;base64,' + TINY_PNG,
    channel: 'general'
  });

  console.log('5) фото в общий чат:', generalPhoto.status === 200 ? 'ok' : `ОШИБКА ${generalPhoto.status} ${generalPhoto.text}`);

  // 6. Чужой сотрудник не должен увидеть фото чужого заказа
  const master = await login('master', 'master12345');
  await call('POST', '/api/unlock', master, { pin: '1111' });

  const me = await call('GET', '/api/me', master);
  const myId = Number(me.json.user ? me.json.user.id : 0);

  const all = await call('GET', '/api/orders?status=accepted,in_work,ready,closed', admin);
  const foreign = all.json.orders.find((order) => order.master_name && !order.master_name.startsWith('Иванов'));

  if (foreign) {
    const foreignPhoto = await call('POST', '/api/photos', admin, {
      image: 'data:image/png;base64,' + TINY_PNG,
      orderId: foreign.id
    });

    const denied = await fetch(BASE + `/api/photos/${foreignPhoto.json.photo.id}`, { headers: { cookie: master } });
    console.log(`6) посторонний маляр (id ${myId}) к фото заказа ${foreign.number}:`,
      denied.status === 403 ? 'закрыт (403) — верно' : `ОШИБКА: ${denied.status}`);
  } else {
    console.log('6) подходящего чужого заказа не нашлось — пропуск');
  }

  // 7. Кривой формат
  const bad = await call('POST', '/api/photos', admin, { image: 'data:text/plain;base64,' + TINY_PNG, orderId });
  console.log('7) не картинка:', bad.status === 400 ? 'отклонено — верно' : `ОШИБКА: ${bad.status}`);
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
