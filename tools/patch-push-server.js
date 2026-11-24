'use strict';

/*
 * Канал уведомлений для Android-приложения.
 *
 *   1. Таблица push_events
 *   2. Функция pushEvent() и хуки: новый заказ, смена статуса, материал на минимуме
 *   3. Долгое ожидание GET /api/push/watch?since=...&timeout=...
 *
 *   node tools/patch-push-server.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, text) => fs.writeFileSync(file, text);

let changed = 0;

/* ---------- 1. Таблица ---------- */

let db = read(path.join(root, 'server', 'db.js'));

if (!db.includes('CREATE TABLE IF NOT EXISTS push_events')) {
  const anchor = '/* Входы в программу: временный журнал для администратора */';

  if (!db.includes(anchor)) {
    console.error('db.js: не нашёл место для таблицы');
    process.exit(1);
  }

  const table = [
    '/* События для уведомлений на телефоне */',
    'CREATE TABLE IF NOT EXISTS push_events (',
    '  id         INTEGER PRIMARY KEY,',
    '  user_id    INTEGER,',
    '  role       TEXT,',
    '  except_id  INTEGER,',
    '  kind       TEXT NOT NULL,',
    '  title      TEXT NOT NULL,',
    '  body       TEXT NOT NULL,',
    '  order_id   INTEGER,',
    '  created_at TEXT NOT NULL',
    ');',
    '',
    'CREATE INDEX IF NOT EXISTS push_events_id_idx ON push_events(id);',
    '',
    anchor
  ].join('\n');

  db = db.replace(anchor, table);
  write(path.join(root, 'server', 'db.js'), db);
  changed++;
  console.log('db.js: таблица push_events');
}

/* ---------- 2. Сервер ---------- */

let server = read(path.join(root, 'server', 'server.js'));

if (!server.includes('function pushEvent')) {
  const anchor = "route('POST', '/api/orders', async ({ user, body }) => {";

  const helper = [
    '/* --------------------------------------------------------------------------',
    '   Уведомления на телефон: события и долгое ожидание',
    '   -------------------------------------------------------------------------- */',
    '',
    '/** Кладём событие в очередь уведомлений. */',
    'function pushEvent({ userId = null, role = null, exceptId = null, kind, title, body, orderId = null }) {',
    '  try {',
    '    db.prepare(`INSERT INTO push_events (user_id, role, except_id, kind, title, body, order_id, created_at)',
    '                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)',
    '      .run(userId, role, exceptId, kind, title, body, orderId, nowISO());',
    '',
    '    // Журнал не должен расти бесконечно',
    '    db.prepare(\'DELETE FROM push_events WHERE id < (SELECT MAX(id) - 2000 FROM push_events)\').run();',
    '  } catch (error) {',
    '    // Уведомление не должно ломать действие',
    '  }',
    '}',
    '',
    '/** Кому положено уведомление. */',
    'function pushWatchers() {',
    '  return db.prepare(`SELECT id, login, full_name, role FROM users',
    '                      WHERE active = 1 AND is_workstation = 0`).all();',
    '}',
    '',
    '/** Долгое ожидание новых событий: телефон держит соединение и сразу получает уведомление. */',
    "route('GET', '/api/push/watch', async ({ user, url }) => {",
    "  const since = Number(url.searchParams.get('since')) || 0;",
    '  const wait = Math.min(Math.max(Number(url.searchParams.get(\'timeout\')) || 25, 5), 50);',
    '  const deadline = Date.now() + wait * 1000;',
    '',
    '  const query = `',
    '    SELECT id, kind, title, body, order_id, created_at',
    '      FROM push_events',
    '     WHERE id > ?',
    '       AND (user_id = ? OR (user_id IS NULL AND (role IS NULL OR role = ?)))',
    '       AND (except_id IS NULL OR except_id <> ?)',
    '     ORDER BY id ASC',
    '     LIMIT 30',
    '  `;',
    '',
    '  while (true) {',
    '    const rows = db.prepare(query).all(since, user.id, user.role, user.id);',
    '',
    '    if (rows.length) {',
    '      return { events: rows, last: rows[rows.length - 1].id };',
    '    }',
    '',
    '    if (Date.now() > deadline) {',
    '      const maxId = db.prepare(\'SELECT COALESCE(MAX(id), 0) AS id FROM push_events\').get().id;',
    '      return { events: [], last: Math.max(Number(maxId), since) };',
    '    }',
    '',
    '    await new Promise((resolve) => setTimeout(resolve, 1500));',
    '  }',
    '});',
    '',
    '/** Сколько событий ждёт пользователя (для проверки и бейджа). */',
    "route('GET', '/api/push/pending', async ({ user, url }) => {",
    "  const since = Number(url.searchParams.get('since')) || 0;",
    '',
    '  const rows = db.prepare(`',
    '    SELECT COUNT(*) AS n FROM push_events',
    '     WHERE id > ?',
    '       AND (user_id = ? OR (user_id IS NULL AND (role IS NULL OR role = ?)))',
    '       AND (except_id IS NULL OR except_id <> ?)',
    '  `).get(since, user.id, user.role, user.id);',
    '',
    '  return { pending: rows.n };',
    '});',
    '',
    anchor
  ].join('\n');

  server = server.replace(anchor, () => helper);
  changed++;
  console.log('server.js: события и /api/push/watch');
}

/* ---------- 3. Новый заказ ---------- */

if (!server.includes("kind: 'order_new'")) {
  server = server.replace(
    "  return { order: orderView(orderId) };\n});",
    [
      '  // Уведомление на телефоны: новый заказ (кроме того, кто его завёл)',
      "  pushEvent({",
      "    exceptId: user.id,",
      "    kind: 'order_new',",
      '    title: `Новый заказ ${number}`,',
      '    body: `${carPlate}${masterId ? \' · маляр \' + db.prepare(\'SELECT full_name FROM users WHERE id = ?\').get(masterId).full_name : \'\'}`,',
      '    orderId',
      '  });',
      '',
      '  return { order: orderView(orderId) };',
      '});'
    ].join('\n')
  );

  changed++;
  console.log('server.js: уведомление о новом заказе');
}

/* ---------- 4. Смена статуса ---------- */

if (!server.includes("kind: 'order_status'")) {
  const anchor = '  return { order: orderView(order.id) };\n});';
  const order = server.indexOf(anchor);

  if (order > 0) {
    const next = [
      '  // Уведомление: статус заказа изменился',
      '  if (patch.status && patch.status !== order.status) {',
      '    const car = db.prepare(\'SELECT plate FROM cars WHERE id = ?\').get(order.car_id);',
      '    const label = STATUS_LABEL[patch.status] || patch.status;',
      '    const title = `Заказ ${order.number}: ${label}`;',
      '    const body = `${car ? car.plate : \'\'}${patch.status === \'ready\' ? \' — готов к выдаче\' : \'\'}`;',
      '',
      '    // Мастеру этого заказа — лично',
      '    const masterId = patch.master_id !== undefined ? patch.master_id : order.master_id;',
      '',
      '    if (masterId && Number(masterId) !== Number(user.id)) {',
      "      pushEvent({ userId: Number(masterId), kind: 'order_status', title, body, orderId: order.id });",
      '    }',
      '',
      '    // Приёмщикам и админу — по роли',
      "    pushEvent({ role: 'manager', exceptId: user.id, kind: 'order_status', title, body, orderId: order.id });",
      "    pushEvent({ role: 'admin', exceptId: user.id, kind: 'order_status', title, body, orderId: order.id });",
      '  }',
      '',
      anchor
    ].join('\n');

    server = server.slice(0, order) + next + server.slice(order + anchor.length);
    changed++;
    console.log('server.js: уведомление о смене статуса');
  }
}

/* ---------- 5. Материал на минимуме ---------- */

if (!server.includes("kind: 'low_stock'")) {
  const anchor = "route('POST', '/api/orders/:id/materials', async ({ user, params, body }) => {";

  if (server.includes(anchor)) {
    const marker = '  return { order: orderView(order.id) };\n});';
    // ищем конец этого маршрута
    const start = server.indexOf(anchor);
    const end = server.indexOf(marker, start);

    if (end > 0) {
      const next = [
        '  // Материал ушёл ниже минимума — предупреждаем склад и админа',
        '  try {',
        '    const grabbed = db.prepare(\'SELECT code, name, qty, min_stock FROM materials WHERE code = ?\')',
        '      .get(String(body.code || \'\'));',
        '',
        '    if (grabbed && Number(grabbed.min_stock) > 0 && Number(grabbed.qty) <= Number(grabbed.min_stock)) {',
        '      const title = `Материал на минимуме: ${grabbed.code}`;',
        '      const body = `${grabbed.name}: осталось ${grabbed.qty}, минимум ${grabbed.min_stock}`;',
        '',
        "      pushEvent({ role: 'store', kind: 'low_stock', title, body });",
        "      pushEvent({ role: 'admin', kind: 'low_stock', title, body });",
        '    }',
        '  } catch (error) {',
        '    /* не критично */',
        '  }',
        '',
        marker
      ].join('\n');

      server = server.slice(0, end) + next + server.slice(end + marker.length);
      changed++;
      console.log('server.js: уведомление о минимуме материала');
    }
  }
}

write(path.join(root, 'server', 'server.js'), server);

console.log('изменений:', changed);
