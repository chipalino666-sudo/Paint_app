'use strict';

/* ==========================================================================
   Сервер малярного цеха. Ноль внешних зависимостей:
   http + node:sqlite из стандартной библиотеки Node.
   ========================================================================== */

const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { db, init, rebuildPaintAliases, nowISO, normalizeSearch, hashPassword, verifyPassword, nextOrderNumber, audit } = require('./db');
const auth = require('./auth');

/* Ключ ИИ и прочие настройки читаем из .env рядом с сервером (файл в .gitignore) */
(() => {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;

  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;

    const value = match[2].replace(/^["']|["']$/g, '');
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
})();

const ai = require('./ai');
const aiAgent = require('./ai-agent');

const PORT = Number(process.env.PAINT_PORT || 3000);
const HOST = process.env.PAINT_HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 24 * 1024 * 1024;      // хватает на PDF-документы
const MAX_DOC_BYTES = 20 * 1024 * 1024;
const DOC_EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const UPLOAD_DIR = process.env.PAINT_UPLOADS || path.join(__dirname, 'data', 'uploads');

// Через сколько минут бездействия кабинет мастера закрывается сам
const IDLE_MINUTES = Number(process.env.PAINT_IDLE_MINUTES || 10);
const IDLE_MS = IDLE_MINUTES * 60 * 1000;

/* --------------------------------------------------------------------------
   Мелкие помощники
   -------------------------------------------------------------------------- */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const canManage = (user) => user.role === 'admin' || user.role === 'manager';
const isStaff = (user) => canManage(user) || user.role === 'store';

// ТДС нужны малярам: они и пополняют справочник документов
const canEditDocs = (user) => isStaff(user) || user.role === 'master';

const STATUS_LABEL = {
  draft: 'Черновик',
  accepted: 'Принят',
  in_work: 'В работе',
  ready: 'Готов',
  closed: 'Закрыт',
  cancelled: 'Отменён'
};

/* --------------------------------------------------------------------------
   Цены и единицы
   -------------------------------------------------------------------------- */

const UNIT_GRAM = { 'г': 1, 'мл': 1, 'кг': 1000, 'л': 1000, 'шт': null };

/**
 * Пересчёт цены из единицы материала в единицу строки списания.
 * Краски списываются в граммах, а продаются литрами: 4200 ₽/л — это 4,20 ₽/г.
 * Поэтому цена умножается на отношение «сколько граммов в нужной единице»
 * к «сколько граммов в единице материала».
 */
function convertPrice(price, fromUnit, toUnit) {
  const a = UNIT_GRAM[fromUnit];
  const b = UNIT_GRAM[toUnit];
  if (a == null || b == null) return round2(price);
  return round2(price * (b / a));
}

function materialPriceFor(code, rowUnit) {
  const material = db.prepare('SELECT price, unit FROM materials WHERE code = ?').get(code);
  if (!material) return 0;
  return convertPrice(Number(material.price) || 0, material.unit, rowUnit);
}

/* --------------------------------------------------------------------------
   Представление заказа
   -------------------------------------------------------------------------- */

function orderView(id) {
  const order = db.prepare(`
    SELECT o.*,
           c.plate, c.vin, c.make, c.model, c.color, c.color_code,
           c.owner_name, c.owner_phone, c.notes AS car_notes,
           m.full_name AS master_name,
           b.full_name AS bodyworker_name,
           u.full_name AS created_by_name
      FROM orders o
      JOIN cars c ON c.id = o.car_id
      LEFT JOIN users m ON m.id = o.master_id
      LEFT JOIN users b ON b.id = o.bodyworker_id
      LEFT JOIN users u ON u.id = o.created_by
     WHERE o.id = ?
  `).get(Number(id));

  if (!order) return null;

  order.works = db.prepare('SELECT * FROM order_works WHERE order_id = ? ORDER BY id').all(order.id);
  order.materials = db.prepare(`
    SELECT om.*, u.full_name AS created_by_name
      FROM order_materials om
      LEFT JOIN users u ON u.id = om.created_by
     WHERE om.order_id = ?
     ORDER BY om.kind, om.id
  `).all(order.id);

  for (const row of order.works) row.sum = round2(row.qty * row.price);
  for (const row of order.materials) row.sum = round2(row.qty * row.price);

  // Акт осмотра хранится как JSON: точки повреждений на схеме
  try {
    order.inspection = order.inspection ? JSON.parse(order.inspection) : [];
  } catch (error) {
    order.inspection = [];
  }

  order.works_sum = round2(order.works.reduce((acc, row) => acc + row.sum, 0));
  order.materials_sum = round2(order.materials.reduce((acc, row) => acc + row.sum, 0));
  order.total = round2(order.works_sum + order.materials_sum);

  return order;
}

function canSeeOrder(user, order) {
  if (isStaff(user)) return true;

  // Маляр видит свои заказы, кузовщик — те, куда его назначили
  return Number(order.master_id) === Number(user.id)
    || Number(order.bodyworker_id) === Number(user.id);
}

/** Списание правится, только пока заказ не сдан. */
function assertEditable(order) {
  if (order.status !== 'accepted' && order.status !== 'in_work') {
    throw new ApiError(400, 'Заказ уже сдан — верните его в работу, чтобы менять списание');
  }
}

/* --------------------------------------------------------------------------
   Поиск
   -------------------------------------------------------------------------- */

function orderList(user, query) {
  const where = [];
  const params = [];

  if (user.role === 'master') {
    // Мастер видит и заказы, где он маляр, и те, куда его позвали кузовщиком
    where.push('(o.master_id = ? OR o.bodyworker_id = ?)');
    params.push(user.id, user.id);
  } else if (query.master_id) {
    where.push('o.master_id = ?');
    params.push(Number(query.master_id));
  }

  const statuses = String(query.status || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (statuses.length) {
    where.push(`o.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }

  const q = normalizeSearch(str(query.q, 100));
  if (q) {
    for (const word of q.split(' ').filter(Boolean)) {
      where.push('(o.number LIKE ? OR c.search LIKE ? OR m.search LIKE ? OR b.search LIKE ?)');
      const like = `%${word}%`;
      params.push(like, like, like, like);
    }
  }

  if (query.from) {
    where.push('substr(o.created_at, 1, 10) >= ?');
    params.push(str(query.from, 10));
  }
  if (query.to) {
    where.push('substr(o.created_at, 1, 10) <= ?');
    params.push(str(query.to, 10));
  }

  const sql = `
    SELECT o.id, o.number, o.status, o.created_at, o.planned_date, o.ready_at, o.closed_at,
           c.plate, c.make, c.model, m.full_name AS master_name, b.full_name AS bodyworker_name,
           (SELECT COALESCE(SUM(qty * price), 0) FROM order_works w WHERE w.order_id = o.id) AS works_sum,
           (SELECT COALESCE(SUM(qty * price), 0) FROM order_materials om WHERE om.order_id = o.id) AS materials_sum,

           -- новые сообщения в обсуждении этого заказа
           (SELECT COUNT(*) FROM messages msg
             WHERE msg.channel = 'order:' || o.id
               AND msg.user_id <> ?
               AND msg.id > COALESCE((SELECT cr.last_id FROM chat_reads cr
                                       WHERE cr.user_id = ? AND cr.channel = 'order:' || o.id), 0)
           ) AS unread_chat,

           -- важные изменения заказа: работы, мастер, статус. Списание материала не считаем
           (SELECT COUNT(*) FROM audit a
             WHERE a.entity = 'order' AND a.entity_id = CAST(o.id AS TEXT)
               AND a.user_id <> ?
               AND a.action IN ('create', 'change', 'work_add', 'work_edit', 'work_remove', 'photo_add')
               AND a.at > COALESCE((SELECT r.seen_at FROM order_reads r
                                     WHERE r.user_id = ? AND r.order_id = o.id), '')
           ) AS unread_changes

      FROM orders o
      JOIN cars c ON c.id = o.car_id
      LEFT JOIN users m ON m.id = o.master_id
      LEFT JOIN users b ON b.id = o.bodyworker_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY o.id DESC
     LIMIT 500
  `;

  return db.prepare(sql).all(user.id, user.id, user.id, user.id, ...params).map((row) => ({
    ...row,
    works_sum: round2(row.works_sum),
    materials_sum: round2(row.materials_sum),
    total: round2(row.works_sum + row.materials_sum)
  }));
}

/* --------------------------------------------------------------------------
   Маршруты
   -------------------------------------------------------------------------- */

const routes = [];

function route(method, pattern, handler) {
  routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
}

function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);

  for (const item of routes) {
    if (item.method !== method) continue;
    if (item.parts.length !== parts.length) continue;

    const params = {};
    let ok = true;

    for (let i = 0; i < item.parts.length; i++) {
      const part = item.parts[i];
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(parts[i]);
      else if (part !== parts[i]) { ok = false; break; }
    }

    if (ok) return { handler: item.handler, params };
  }

  return null;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, 'Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new ApiError(400, 'Некорректный JSON в запросе'));
      }
    });

    req.on('error', reject);
  });
}

/* --------------------------------------------------------------------------
   Вход и пользователь
   -------------------------------------------------------------------------- */

/** Запрос пришёл по HTTPS? За прокси Caddy это видно по заголовку. */
function isSecureRequest(req) {
  if (req.socket && req.socket.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

route('POST', '/api/login', async ({ body, res, req }) => {
  const login = str(body.login, 100).toLowerCase();
  const password = String(body.password ?? '');

  const user = db.prepare('SELECT * FROM users WHERE lower(login) = ?').get(login);

  if (!user || !user.active || !verifyPassword(password, user.pass_hash)) {
    // Одинаковый ответ: не подсказываем, существует ли такой логин
    throw new ApiError(401, 'Неверный логин или пароль');
  }

  const session = auth.createSession(user.id);
  auth.setSessionCookie(res, session.token, session.expires, isSecureRequest(req));

  audit(user.id, 'login', 'user', user.id, null);

  return {
    user: {
      id: user.id, login: user.login, full_name: user.full_name,
      role: user.role, is_workstation: Boolean(user.is_workstation)
    },
    // На рабочем месте мастеров после входа сразу просим ПИН
    locked: Boolean(user.is_workstation),
    workstation: Boolean(user.is_workstation)
  };
});

route('POST', '/api/logout', async ({ req, res, user }) => {
  const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE_NAME];
  auth.destroySession(token);
  auth.clearSessionCookie(res, isSecureRequest(req));
  return { ok: true };
});

route('GET', '/api/me', async ({ user, sessionData }) => {
  if (!sessionData) return { user: null, locked: true };

  if (sessionData.account.is_workstation) {
    return {
      user: user || null,
      workstation: true,
      locked: !user,
      account: sessionData.account.full_name,
      idle_minutes: IDLE_MINUTES
    };
  }

  return { user };
});

/* --------------------------------------------------------------------------
   Рабочее место мастеров: вход по ПИН-коду

   ПИН — не пароль и не средство защиты: он нужен, чтобы случайно не начать
   работу в чужом кабинете. Мастера пользуются одним компьютером и могут
   войти под любым ПИНом, в том числе чтобы доделать заказ за отсутствующего.
   -------------------------------------------------------------------------- */

route('POST', '/api/unlock', async ({ body, token, sessionData }) => {
  if (!sessionData) throw new ApiError(401, 'Нужно войти');
  if (!sessionData.account.is_workstation) throw new ApiError(400, 'Это не рабочее место мастера');

  const pin = String(body.pin ?? '').replace(/\D/g, '');
  if (pin.length !== 4) throw new ApiError(400, 'ПИН-код — четыре цифры');

  // ПИН есть только у маляров: кузовщик на общем компьютере не работает
  const masters = db.prepare(`
    SELECT id, full_name, pin_hash
      FROM users
     WHERE role = 'master' AND active = 1 AND is_workstation = 0
       AND COALESCE(specialty, 'painter') = 'painter'
       AND pin_hash IS NOT NULL
  `).all();

  const found = masters.find((master) => verifyPassword(pin, master.pin_hash));

  if (!found) throw new ApiError(400, 'Такого ПИН-кода нет — проверьте цифры');

  auth.touchSession(token, found.id);
  audit(found.id, 'unlock', 'workstation', found.id, { text: `${found.full_name} открыл свой кабинет` });

  return {
    user: { id: found.id, full_name: found.full_name, role: 'master', is_workstation: false }
  };
});

route('POST', '/api/lock', async ({ token, sessionData, user }) => {
  if (sessionData && sessionData.account.is_workstation) {
    auth.lockSession(token);
    if (user) audit(user.id, 'lock', 'workstation', user.id, { text: `${user.full_name} вышел` });
  }

  return { ok: true };
});

route('POST', '/api/me/password', async ({ user, body }) => {
  const current = String(body.current ?? '');
  const next = String(body.next ?? '');

  if (next.length < 6) throw new ApiError(400, 'Новый пароль короче 6 символов');

  const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(current, row.pass_hash)) throw new ApiError(400, 'Текущий пароль неверный');

  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
  audit(user.id, 'password', 'user', user.id, null);

  return { ok: true };
});

/* --------------------------------------------------------------------------
   Заказы
   -------------------------------------------------------------------------- */

route('GET', '/api/orders', async ({ user, url }) => {
  const query = Object.fromEntries(url.searchParams.entries());
  return { orders: orderList(user, query) };
});

route('GET', '/api/orders/:id', async ({ user, params }) => {
  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  if (!canSeeOrder(user, order)) throw new ApiError(403, 'Это не ваш заказ');

  // Заказ открыли — значит видели все его изменения на этот момент
  db.prepare(`INSERT INTO order_reads (user_id, order_id, seen_at) VALUES (?, ?, ?)
              ON CONFLICT(user_id, order_id) DO UPDATE SET seen_at = excluded.seen_at`)
    .run(user.id, order.id, nowISO());

  return { order };
});

route('POST', '/api/orders', async ({ user, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Заводить заказы может приёмщик');

  const carInput = body.car || {};
  let carId = body.car_id ? Number(body.car_id) : null;

  if (carId) {
    const exists = db.prepare('SELECT id FROM cars WHERE id = ?').get(carId);
    if (!exists) throw new ApiError(400, 'Машина не найдена');
  } else {
    const plate = str(carInput.plate, 30).toUpperCase();
    if (!plate) throw new ApiError(400, 'Укажите номер машины');

    // Если машина с таким номером уже есть — не плодим дубликат
    const existing = db.prepare('SELECT id FROM cars WHERE upper(plate) = ?').get(plate);

    if (existing) {
      carId = existing.id;
      db.prepare(`UPDATE cars SET vin = COALESCE(NULLIF(?, ''), vin),
                                  make = COALESCE(NULLIF(?, ''), make),
                                  model = COALESCE(NULLIF(?, ''), model),
                                  color = COALESCE(NULLIF(?, ''), color),
                                  color_code = COALESCE(NULLIF(?, ''), color_code),
                                  owner_name = COALESCE(NULLIF(?, ''), owner_name),
                                  owner_phone = COALESCE(NULLIF(?, ''), owner_phone)
                   WHERE id = ?`)
        .run(str(carInput.vin, 40), str(carInput.make, 60), str(carInput.model, 60),
          str(carInput.color, 60), str(carInput.color_code, 40),
          str(carInput.owner_name, 120), str(carInput.owner_phone, 40), carId);
    } else {
      const info = db.prepare(`INSERT INTO cars (plate, vin, make, model, color, color_code, owner_name, owner_phone, notes, created_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(plate, str(carInput.vin, 40), str(carInput.make, 60), str(carInput.model, 60),
          str(carInput.color, 60), str(carInput.color_code, 40),
          str(carInput.owner_name, 120), str(carInput.owner_phone, 40),
          str(carInput.notes, 500), nowISO());
      carId = Number(info.lastInsertRowid);
    }
  }

  const masterId = body.master_id ? Number(body.master_id) : null;
  if (masterId) {
    const master = db.prepare(`
      SELECT id FROM users
       WHERE id = ? AND role = 'master' AND active = 1 AND is_workstation = 0
         AND COALESCE(specialty, 'painter') = 'painter'
    `).get(masterId);
    if (!master) throw new ApiError(400, 'Маляр не найден');
  }

  const bodyworkerId = body.bodyworker_id ? Number(body.bodyworker_id) : null;
  if (bodyworkerId) {
    const worker = db.prepare(`
      SELECT id FROM users
       WHERE id = ? AND role = 'master' AND active = 1 AND specialty = 'bodyworker'
    `).get(bodyworkerId);
    if (!worker) throw new ApiError(400, 'Кузовщик не найден');
  }

  // Поисковое поле машины: по нему ищутся и заказы, и сама машина
  const carRow = db.prepare('SELECT plate, vin, make, model FROM cars WHERE id = ?').get(carId);
  db.prepare('UPDATE cars SET search = ? WHERE id = ?')
    .run(normalizeSearch(carRow.plate, carRow.vin, carRow.make, carRow.model), carId);

  const number = nextOrderNumber();
  const now = nowISO();

  const info = db.prepare(`INSERT INTO orders (number, car_id, master_id, bodyworker_id, created_by, status, planned_date, comment, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?)`)
    .run(number, carId, masterId, bodyworkerId, user.id, str(body.planned_date, 10) || null,
      str(body.comment, 1000), now, now);

  const orderId = Number(info.lastInsertRowid);

  const works = Array.isArray(body.works) ? body.works : [];
  const insertWork = db.prepare('INSERT INTO order_works (order_id, work_id, name, qty, price, parts) VALUES (?, ?, ?, ?, ?, ?)');

  for (const row of works) {
    const work = db.prepare('SELECT * FROM works WHERE id = ?').get(Number(row.work_id));
    if (!work) continue;
    const qty = Math.max(0, toNum(row.qty, 1)) || 1;
    insertWork.run(orderId, work.id, work.name, qty, round2(toNum(row.price, work.price)), work.parts || 1);
  }

  const carPlate = db.prepare('SELECT plate FROM cars WHERE id = ?').get(carId).plate;
  const crew = [];
  if (masterId) crew.push(`маляр ${db.prepare('SELECT full_name FROM users WHERE id = ?').get(masterId).full_name}`);
  if (bodyworkerId) crew.push(`кузовщик ${db.prepare('SELECT full_name FROM users WHERE id = ?').get(bodyworkerId).full_name}`);

  audit(user.id, 'create', 'order', orderId, {
    number, carId, masterId, bodyworkerId,
    text: `Заказ создан, машина ${carPlate}${crew.length ? ' — ' + crew.join(', ') : ''}`
  });

  return { order: orderView(orderId) };
});

route('PATCH', '/api/orders/:id', async ({ user, params, body }) => {
  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  if (!canSeeOrder(user, order)) throw new ApiError(403, 'Это не ваш заказ');

  const patch = {};
  const changes = [];  // что попадёт в журнал: человеческие строки
  const isManager = canManage(user);
  const isOwnMaster = Number(order.master_id) === Number(user.id);

  /* ---- статус ---- */

  if (body.status !== undefined) {
    const status = str(body.status, 20);
    const allowed = ['accepted', 'in_work', 'ready', 'closed', 'cancelled'];
    if (!allowed.includes(status)) throw new ApiError(400, 'Неизвестный статус');

    if (status === 'ready') {
      if (!isManager && !isOwnMaster) throw new ApiError(403, 'Сдать заказ может мастер или приёмщик');
    } else if (!isManager) {
      throw new ApiError(403, 'Статус может менять только приёмщик');
    }

    if (order.status === 'closed' && status !== 'closed') {
      throw new ApiError(400, 'Закрытый заказ нельзя вернуть в работу');
    }

    patch.status = status;
    changes.push({ text: `Статус: ${STATUS_LABEL[order.status] || order.status} → ${STATUS_LABEL[status] || status}` });
  }

  /* ---- маляр ---- */

  if (body.master_id !== undefined) {
    if (!isManager) throw new ApiError(403, 'Маляра назначает приёмщик');

    const masterId = body.master_id ? Number(body.master_id) : null;
    let afterName = 'не назначен';

    if (masterId) {
      const master = db.prepare(`
        SELECT id, full_name FROM users
         WHERE id = ? AND role = 'master' AND active = 1 AND is_workstation = 0
           AND COALESCE(specialty, 'painter') = 'painter'
      `).get(masterId);
      if (!master) throw new ApiError(400, 'Маляр не найден');
      afterName = master.full_name;
    }

    const beforeName = order.master_name || 'не назначен';
    if (beforeName !== afterName) changes.push({ text: `Маляр: ${beforeName} → ${afterName}` });

    patch.master_id = masterId;
  }

  /* ---- кузовщик ---- */

  if (body.bodyworker_id !== undefined) {
    if (!isManager) throw new ApiError(403, 'Кузовщика назначает приёмщик');

    const workerId = body.bodyworker_id ? Number(body.bodyworker_id) : null;
    let afterName = 'не назначен';

    if (workerId) {
      const worker = db.prepare(`
        SELECT id, full_name FROM users
         WHERE id = ? AND role = 'master' AND active = 1 AND specialty = 'bodyworker'
      `).get(workerId);
      if (!worker) throw new ApiError(400, 'Кузовщик не найден');
      afterName = worker.full_name;
    }

    const beforeName = order.bodyworker_name || 'не назначен';
    if (beforeName !== afterName) changes.push({ text: `Кузовщик: ${beforeName} → ${afterName}` });

    patch.bodyworker_id = workerId;
  }

  /* ---- плановая дата ---- */

  if (body.planned_date !== undefined) {
    if (!isManager && !isOwnMaster) throw new ApiError(403, 'Нет прав');

    const value = str(body.planned_date, 10) || null;
    if ((order.planned_date || null) !== value) {
      changes.push({ text: `Плановая дата: ${order.planned_date || '—'} → ${value || '—'}` });
    }
    patch.planned_date = value;
  }

  /* ---- комментарий ---- */

  if (body.comment !== undefined) {
    if (!isManager) throw new ApiError(403, 'Комментарий меняет приёмщик');

    const value = str(body.comment, 1000);
    if ((order.comment || '') !== value) {
      changes.push({ text: 'Комментарий изменён' });
      patch.comment = value;
    }
  }

  /* ---- данные машины ---- */

  if (body.car !== undefined) {
    const car = body.car || {};

    const labels = {
      plate: 'Госномер',
      vin: 'VIN',
      make: 'Марка',
      model: 'Модель',
      color: 'Цвет',
      color_code: 'Код краски',
      owner_name: 'Владелец',
      owner_phone: 'Телефон'
    };

    // Мастер заполняет только код краски (для списания), остальное — приёмщик
    const masterFields = ['color_code'];

    if (!isManager) {
      if (!isOwnMaster) throw new ApiError(403, 'Это не ваш заказ');

      const forbidden = Object.keys(car).filter((field) => !masterFields.includes(field));
      if (forbidden.length) throw new ApiError(403, 'Кроме кода краски данные машины меняет приёмщик');

      if (order.status === 'closed' || order.status === 'cancelled') {
        throw new ApiError(400, 'Заказ закрыт');
      }
    }

    const current = db.prepare('SELECT * FROM cars WHERE id = ?').get(order.car_id);
    const sets = [];
    const values = [];

    for (const [field, label] of Object.entries(labels)) {
      if (car[field] === undefined) continue;

      const next = field === 'plate' ? str(car[field], 30).toUpperCase() : str(car[field], 120);
      const previous = current[field] || '';

      if (next === previous) continue;

      sets.push(`${field} = ?`);
      values.push(next);
      changes.push({ text: `${label}: ${previous || '—'} → ${next || '—'}` });
    }

    if (sets.length) {
      db.prepare(`UPDATE cars SET ${sets.join(', ')} WHERE id = ?`).run(...values, current.id);

      const row = db.prepare('SELECT plate, vin, make, model FROM cars WHERE id = ?').get(current.id);
      db.prepare('UPDATE cars SET search = ? WHERE id = ?')
        .run(normalizeSearch(row.plate, row.vin, row.make, row.model), current.id);
    }
  }

  if (!Object.keys(patch).length && !changes.length) throw new ApiError(400, 'Ничего не изменилось');

  const now = nowISO();
  const sets = [];
  const values = [];

  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }

  if (patch.status === 'ready') { sets.push('ready_at = ?'); values.push(now); }
  if (patch.status === 'closed') { sets.push('closed_at = ?'); values.push(now); }
  if (patch.status && patch.status !== 'ready' && patch.status !== 'closed') { sets.push('ready_at = NULL'); }
  if (patch.status && patch.status !== 'closed' && order.status === 'closed') { sets.push('closed_at = NULL'); }

  sets.push('updated_at = ?');
  values.push(now, Number(params.id));

  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  // Одно сохранение — одна запись в журнале: «что изменили» списком
  if (changes.length) {
    audit(user.id, 'change', 'order', order.id, {
      text: changes.map((change) => change.text).join('; ')
    });
  }

  return { order: orderView(order.id) };
});

/* ---- История изменений заказа ------------------------------------------- */

route('GET', '/api/orders/:id/history', async ({ user, params }) => {
  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  if (!canSeeOrder(user, order)) throw new ApiError(403, 'Это не ваш заказ');

  const rows = db.prepare(`
    SELECT a.at, a.action, a.payload, u.full_name AS user_name
      FROM audit a
      LEFT JOIN users u ON u.id = a.user_id
     WHERE a.entity = 'order' AND a.entity_id = ?
     ORDER BY a.id DESC
     LIMIT 200
  `).all(String(order.id));

  const history = rows.map((row) => {
    let payload = {};
    try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch (e) { payload = {}; }

    return {
      at: row.at,
      user: row.user_name || 'система',
      text: payload.text || fallbackText(row.action, payload)
    };
  });

  return { history };
});

/** Описание для старых записей журнала, где текст ещё не сохранялся. */
function fallbackText(action, payload) {
  switch (action) {
    case 'create': return 'Заказ создан';
    case 'material_add': return `Списано: ${payload.code || ''} — ${payload.qty || ''}`;
    case 'material_edit': return 'Изменено количество материала';
    case 'material_remove': return 'Удалена строка списания';
    case 'work_add': return `Добавлена работа: ${payload.work || ''}`;
    case 'work_remove': return 'Удалена работа';
    case 'work_edit': return 'Изменена работа';
    case 'photo_add': return 'Добавлена фотография';
    default: return action;
  }
}

/** Детали считаются только у покраски: остальные работы — за штуку. */
function isPaintWork(name, category) {
  return /покраск/i.test(String(category || '')) || /^\s*покраск/i.test(String(name || ''));
}

route('PATCH', '/api/orders/:id/inspection', async ({ user, params, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Акт осмотра заполняет приёмщик');

  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  assertEditable(order);

  const list = Array.isArray(body.inspection) ? body.inspection.slice(0, 200) : [];

  // Принимаем только понятные точки: схема, координаты в процентах, тип повреждения
  const clean = list
    .filter((item) => item && (item.view === 'top' || item.view === 'side'))
    .map((item) => ({
      view: item.view,
      x: Math.min(100, Math.max(0, toNum(item.x, 50))),
      y: Math.min(100, Math.max(0, toNum(item.y, 50))),
      type: str(item.type, 30) || 'вмятина',
      zone: str(item.zone, 40),
      note: str(item.note, 120)
    }));

  db.prepare('UPDATE orders SET inspection = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(clean), nowISO(), order.id);

  audit(user.id, 'inspection', 'order', order.id, {
    text: `Акт осмотра: повреждений ${clean.length}`
  });

  return { order: orderView(order.id) };
});

/* ---- Работы в заказе --------------------------------------------------- */

route('POST', '/api/orders/:id/works', async ({ user, params, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Работы добавляет приёмщик');

  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  assertEditable(order);

  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(Number(body.work_id));
  if (!work) throw new ApiError(400, 'Работа не найдена из прайса');

  const qty = Math.max(0, toNum(body.qty, 1)) || 1;
  const price = body.price !== undefined ? round2(toNum(body.price, work.price)) : work.price;

  db.prepare('INSERT INTO order_works (order_id, work_id, name, qty, price, parts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(order.id, work.id, work.name, qty, price, work.parts || 1);

  audit(user.id, 'work_add', 'order', order.id, {
    work: work.name, qty, text: `Добавлена работа: ${work.name}`
  });

  return { order: orderView(order.id) };
});

route('PATCH', '/api/orders/:id/works/:wid', async ({ user, params, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Работы правит приёмщик');

  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  assertEditable(order);

  const row = db.prepare('SELECT * FROM order_works WHERE id = ? AND order_id = ?')
    .get(Number(params.wid), order.id);
  if (!row) throw new ApiError(404, 'Строка не найдена');

  const qty = body.qty !== undefined ? Math.max(0, round2(toNum(body.qty, row.qty))) : row.qty;
  const price = body.price !== undefined ? round2(toNum(body.price, row.price)) : row.price;

  if (qty === row.qty && price === row.price) return { order: orderView(order.id) };

  db.prepare('UPDATE order_works SET qty = ?, price = ? WHERE id = ?').run(qty, price, row.id);

  const parts = [];
  if (qty !== row.qty) parts.push(`кол-во ${row.qty} → ${qty}`);
  if (price !== row.price) parts.push(`цена ${row.price} → ${price}`);

  audit(user.id, 'work_edit', 'order', order.id, {
    work: row.name, text: `Работа «${row.name}»: ${parts.join(', ')}`
  });

  return { order: orderView(order.id) };
});

route('DELETE', '/api/orders/:id/works/:wid', async ({ user, params }) => {
  if (!canManage(user)) throw new ApiError(403, 'Нет прав');

  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  assertEditable(order);

  const row = db.prepare('SELECT * FROM order_works WHERE id = ? AND order_id = ?')
    .get(Number(params.wid), order.id);
  if (!row) throw new ApiError(404, 'Строка не найдена');

  db.prepare('DELETE FROM order_works WHERE id = ?').run(row.id);

  audit(user.id, 'work_remove', 'order', order.id, {
    text: `Убрана работа: ${row.name}`
  });

  return { order: orderView(order.id) };
});

/* ---- Списание материалов ----------------------------------------------- */

route('POST', '/api/orders/:id/materials', async ({ user, params, body }) => {
  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  if (!canSeeOrder(user, order)) throw new ApiError(403, 'Это не ваш заказ');
  assertEditable(order);

  const kind = body.kind === 'paint' ? 'paint' : 'material';
  const code = str(body.code, 40) || '—';
  const name = str(body.name, 300);
  const unit = str(body.unit, 10) || (kind === 'paint' ? 'г' : 'шт');
  const qty = round2(toNum(body.qty, 1));

  if (!name) throw new ApiError(400, 'Не указан материал');
  if (!(qty > 0)) throw new ApiError(400, 'Количество должно быть больше нуля');

  // Тот же материал — складываем количество, а не плодим строки
  const existing = db.prepare('SELECT * FROM order_materials WHERE order_id = ? AND code = ? AND kind = ?')
    .get(order.id, code, kind);

  if (existing) {
    db.prepare('UPDATE order_materials SET qty = ? WHERE id = ?')
      .run(round2(existing.qty + qty), existing.id);
  } else {
    db.prepare(`INSERT INTO order_materials (order_id, code, name, unit, kind, qty, price, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(order.id, code, name, unit, kind, qty, materialPriceFor(code, unit), user.id, nowISO());
  }

  db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(nowISO(), order.id);
  audit(user.id, 'material_add', 'order', order.id, {
    code, qty, kind, text: `Списано: ${name} — ${qty} ${unit}`
  });

  return { order: orderView(order.id) };
});

route('PATCH', '/api/orders/:id/materials/:mid', async ({ user, params, body }) => {
  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  if (!canSeeOrder(user, order)) throw new ApiError(403, 'Это не ваш заказ');
  assertEditable(order);

  const row = db.prepare('SELECT * FROM order_materials WHERE id = ? AND order_id = ?')
    .get(Number(params.mid), order.id);
  if (!row) throw new ApiError(404, 'Строка не найдена');

  const qty = round2(toNum(body.qty, row.qty));
  if (!(qty > 0)) throw new ApiError(400, 'Количество должно быть больше нуля');

  const unit = body.unit ? str(body.unit, 10) : row.unit;
  const price = unit !== row.unit ? materialPriceFor(row.code, unit) : row.price;

  db.prepare('UPDATE order_materials SET qty = ?, unit = ?, price = ? WHERE id = ?')
    .run(qty, unit, price, row.id);

  audit(user.id, 'material_edit', 'order', order.id, {
    row: row.id,
    text: `«${row.name}»: ${row.qty} → ${qty} ${unit}`
  });

  return { order: orderView(order.id) };
});

route('DELETE', '/api/orders/:id/materials/:mid', async ({ user, params }) => {
  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  if (!canSeeOrder(user, order)) throw new ApiError(403, 'Это не ваш заказ');
  assertEditable(order);

  const row = db.prepare('SELECT * FROM order_materials WHERE id = ? AND order_id = ?')
    .get(Number(params.mid), order.id);
  if (!row) throw new ApiError(404, 'Строка не найдена');

  db.prepare('DELETE FROM order_materials WHERE id = ?').run(row.id);

  audit(user.id, 'material_remove', 'order', order.id, {
    row: row.id, text: `Убрано: ${row.name} (${row.qty} ${row.unit})`
  });

  return { order: orderView(order.id) };
});

/* --------------------------------------------------------------------------
   Машины
   -------------------------------------------------------------------------- */

route('GET', '/api/cars', async ({ url }) => {
  const q = normalizeSearch(str(url.searchParams.get('q'), 100));
  const words = q.split(' ').filter(Boolean);

  const cars = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM orders o WHERE o.car_id = c.id) AS visits,
           (SELECT MAX(created_at) FROM orders o WHERE o.car_id = c.id) AS last_visit
      FROM cars c
     ${words.length ? 'WHERE ' + words.map(() => 'c.search LIKE ?').join(' AND ') : ''}
     ORDER BY c.id DESC
     LIMIT 50
  `).all(...words.map((word) => `%${word}%`));

  return { cars };
});

route('GET', '/api/cars/:id', async ({ params }) => {
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(Number(params.id));
  if (!car) throw new ApiError(404, 'Машина не найдена');

  car.orders = db.prepare(`
    SELECT o.id, o.number, o.status, o.created_at, o.closed_at, u.full_name AS master_name
      FROM orders o LEFT JOIN users u ON u.id = o.master_id
     WHERE o.car_id = ?
     ORDER BY o.id DESC
  `).all(car.id);

  return { car };
});

/* --------------------------------------------------------------------------
   Справочники
   -------------------------------------------------------------------------- */

route('GET', '/api/materials', async ({ url }) => {
  const q = normalizeSearch(str(url.searchParams.get('q'), 100));
  const category = str(url.searchParams.get('category'), 30);

  const where = ['active = 1'];
  const params = [];

  let order = 'ORDER BY name';
  const orderParams = [];

  // Если ищут код краски — находим и по соответствиям другой системы
  const isCode = /^\d{2,4}$/.test(q);

  if (q && isCode) {
    const codes = new Set([q]);

    for (const row of db.prepare('SELECT code_a, code_b FROM code_pairs WHERE code_a = ? OR code_b = ?').all(q, q)) {
      codes.add(row.code_a);
      codes.add(row.code_b);
    }

    const list = [...codes].filter(Boolean);

    const prefix = list.map(() => 'paint_code LIKE ?');

    where.push(`(${prefix.join(' OR ')} OR search LIKE ?)`);
    params.push(...list.map((code) => `${code}%`), `%${q}%`);

    // Материал с точно таким кодом показываем первым
    order = `ORDER BY CASE WHEN paint_code IN (${list.map(() => '?').join(',')}) THEN 0 ELSE 1 END, name`;
    orderParams.push(...list);
  } else if (q) {
    // Ищем по каждому слову отдельно: «краска 563» найдёт «Краска MIX 563 Schwarz»
    for (const word of q.split(/\s+/).filter(Boolean)) {
      where.push('search LIKE ?');
      params.push(`%${word}%`);
    }
  }

  if (category && category !== 'all') {
    where.push('category = ?');
    params.push(category);
  }

  const materials = db.prepare(`
    SELECT code, name, unit, category, price, paint_code, aliases, stock,
           COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = materials.code), 0) AS used
      FROM materials
     WHERE ${where.join(' AND ')}
     ${order}
     LIMIT 60
  `).all(...params, ...orderParams);

  // Остаток: склад минус всё, что уже списано в заказах
  for (const row of materials) {
    row.stock_left = round2((Number(row.stock) || 0) - (Number(row.used) || 0));
  }

  return { materials };
});

route('PATCH', '/api/materials/:code', async ({ user, params, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Справочник правит приёмщик или админ');

  const material = db.prepare('SELECT * FROM materials WHERE code = ?').get(params.code);
  if (!material) throw new ApiError(404, 'Материал не найден');

  db.prepare('UPDATE materials SET price = ?, unit = ? WHERE code = ?')
    .run(body.price !== undefined ? round2(toNum(body.price, material.price)) : material.price,
      body.unit ? str(body.unit, 10) : material.unit,
      material.code);

  return { ok: true };
});

route('POST', '/api/materials', async ({ user, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Нет прав');

  const code = str(body.code, 40);
  const name = str(body.name, 300);
  if (!name) throw new ApiError(400, 'Укажите наименование');

  const finalCode = code || `MAN-${Date.now().toString(36).toUpperCase()}`;
  const unit = str(body.unit, 10) || 'шт';
  const category = str(body.category, 30) || 'other';
  const price = round2(toNum(body.price, 0));

  db.prepare(`INSERT INTO materials (code, name, unit, category, price, active, synced_at, search)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?)
              ON CONFLICT(code) DO UPDATE SET name = excluded.name, unit = excluded.unit,
                                             price = excluded.price, search = excluded.search`)
    .run(finalCode, name, unit, category, price, nowISO(), normalizeSearch(finalCode, name));

  return { code: finalCode };
});

route('GET', '/api/works', async () => {
  const works = db.prepare('SELECT * FROM works WHERE active = 1 ORDER BY category, name').all();
  return { works };
});

route('POST', '/api/works', async ({ user, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Прайс правит приёмщик или админ');

  const name = str(body.name, 200);
  if (!name) throw new ApiError(400, 'Укажите название работы');

  const category = str(body.category, 60) || 'Прочее';
  const parts = isPaintWork(name, category) ? (round2(toNum(body.parts, 1)) || 1) : null;

  const info = db.prepare('INSERT INTO works (name, category, price, unit, parts, active) VALUES (?, ?, ?, ?, ?, 1)')
    .run(name, category, round2(toNum(body.price, 0)), str(body.unit, 10) || 'шт', parts);

  return { id: Number(info.lastInsertRowid) };
});

route('PATCH', '/api/works/:id', async ({ user, params, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Прайс правит приёмщик или админ');

  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(Number(params.id));
  if (!work) throw new ApiError(404, 'Работа не найдена');

  db.prepare('UPDATE works SET name = ?, category = ?, price = ?, parts = ?, active = ? WHERE id = ?')
    .run(body.name !== undefined ? str(body.name, 200) : work.name,
      body.category !== undefined ? str(body.category, 60) : work.category,
      body.price !== undefined ? round2(toNum(body.price, work.price)) : work.price,
      isPaintWork(body.name !== undefined ? str(body.name, 200) : work.name, body.category !== undefined ? str(body.category, 60) : work.category)
        ? (round2(toNum(body.parts, work.parts || 1)) || 1)
        : null,
      body.active !== undefined ? (body.active ? 1 : 0) : work.active,
      work.id);

  return { ok: true };
});

/* ---- Клиенты ------------------------------------------------------------- */

/** Телефон приводим к одному виду: только цифры, 8 в начале → 7. */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');

  if (!digits) return '';
  if (digits.length === 11 && digits[0] === '8') return '7' + digits.slice(1);
  if (digits.length === 10) return '7' + digits;

  return digits;
}

/** Заказы и машины, разложенные по нормализованному телефону владельца. */
function clientsIndex() {
  const cars = db.prepare(`
    SELECT id, plate, make, model, owner_name, owner_phone
      FROM cars
     WHERE owner_phone IS NOT NULL AND owner_phone <> ''
  `).all();

  const orders = db.prepare(`
    SELECT o.id, o.number, o.status, o.created_at, o.closed_at, o.car_id,
           (SELECT COALESCE(SUM(qty * price), 0) FROM order_works w WHERE w.order_id = o.id) AS works_sum,
           (SELECT COALESCE(SUM(qty * price), 0) FROM order_materials m WHERE m.order_id = o.id) AS materials_sum
      FROM orders o
  `).all();

  const byCar = new Map();

  for (const order of orders) {
    if (!byCar.has(order.car_id)) byCar.set(order.car_id, []);
    byCar.get(order.car_id).push(order);
  }

  const clients = new Map();

  for (const car of cars) {
    const phone = normalizePhone(car.owner_phone);
    if (!phone) continue;

    if (!clients.has(phone)) {
      clients.set(phone, { phone, name: '', cars: [], orders: [] });
    }

    const client = clients.get(phone);
    if (!client.name && car.owner_name) client.name = car.owner_name;
    client.cars.push(car);
    client.orders.push(...(byCar.get(car.id) || []));
  }

  return clients;
}

function clientSummary(client) {
  const done = client.orders.filter((order) => order.status !== 'cancelled');
  const total = done.reduce((sum, order) => sum + order.works_sum + order.materials_sum, 0);
  const dates = done.map((order) => order.closed_at || order.created_at).filter(Boolean).sort();

  return {
    phone: client.phone,
    name: client.name,
    cars: client.cars.length,
    plates: client.cars.map((car) => car.plate).slice(0, 4),
    orders: done.length,
    total: round2(total),
    first_at: dates[0] || null,
    last_at: dates[dates.length - 1] || null
  };
}

route('GET', '/api/clients', async ({ url }) => {
  const q = normalizeSearch(str(url.searchParams.get('q'), 60));
  const digits = q.replace(/\D/g, '');

  const list = [];

  for (const client of clientsIndex().values()) {
    const haystack = normalizeSearch(client.name, client.phone, ...client.cars.map((car) => car.plate));

    const matches = !q
      || haystack.includes(q)
      || (digits && client.phone.includes(digits));

    if (matches) list.push(clientSummary(client));
  }

  list.sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || '')));

  return { clients: list.slice(0, 200) };
});

route('GET', '/api/clients/:phone', async ({ params }) => {
  const phone = normalizePhone(params.phone);
  const client = clientsIndex().get(phone);

  if (!client) throw new ApiError(404, 'Клиент не найден');

  const orders = client.orders.map((order) => {
    const works = db.prepare('SELECT name FROM order_works WHERE order_id = ? ORDER BY id').all(order.id);

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      created_at: order.created_at,
      closed_at: order.closed_at,
      total: round2(order.works_sum + order.materials_sum),
      works: works.map((row) => row.name)
    };
  });

  return {
    client: clientSummary(client),
    cars: client.cars.map((car) => ({
      plate: car.plate,
      make: car.make,
      model: car.model
    })),
    orders
  };
});

/* ---- Избранные материалы ------------------------------------------------ */

route('GET', '/api/favorites', async ({ user }) => {
  const rows = db.prepare(`
    SELECT f.code, m.name, m.unit, m.stock,
           COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = m.code), 0) AS used
      FROM favorites f
      LEFT JOIN materials m ON m.code = f.code
     WHERE f.user_id = ?
     ORDER BY f.created_at DESC
  `).all(user.id);

  return {
    favorites: rows.map((row) => ({
      code: row.code,
      name: row.name || row.code,
      unit: row.unit || 'шт',
      stock_left: round2((Number(row.stock) || 0) - (Number(row.used) || 0))
    }))
  };
});

route('POST', '/api/favorites', async ({ user, body }) => {
  const code = str(body.code, 40);
  if (!code) throw new ApiError(400, 'Не указан материал');

  db.prepare('INSERT OR IGNORE INTO favorites (user_id, code, created_at) VALUES (?, ?, ?)')
    .run(user.id, code, nowISO());

  return { ok: true };
});

route('DELETE', '/api/favorites/:code', async ({ user, params }) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND code = ?').run(user.id, params.code);
  return { ok: true };
});

/* ---- Перевод кодов красок ------------------------------------------------ */

/** Код приводим к простому виду: без пробелов и лишних знаков. */
function normalizeCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^0-9A-ZА-Я]/g, '').slice(0, 10);
}

route('GET', '/api/codes', async ({ url }) => {
  const q = normalizeCode(url.searchParams.get('q'));

  const pairs = q
    ? db.prepare('SELECT * FROM code_pairs WHERE code_a LIKE ? OR code_b LIKE ? ORDER BY code_a LIMIT 500').all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM code_pairs ORDER BY id DESC LIMIT 500').all();

  return { pairs };
});

route('POST', '/api/codes', async ({ user, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Коды правит приёмщик или админ');

  const a = normalizeCode(body.code_a);
  const b = normalizeCode(body.code_b);

  if (!a || !b) throw new ApiError(400, 'Нужны два кода');
  if (a === b) throw new ApiError(400, 'Коды совпадают');

  const info = db.prepare('INSERT OR IGNORE INTO code_pairs (code_a, code_b, created_at) VALUES (?, ?, ?)')
    .run(a, b, nowISO());

  rebuildPaintAliases();

  return { ok: true, added: info.changes > 0 };
});

route('POST', '/api/codes/import', async ({ user, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Коды правит приёмщик или админ');

  const text = String(body.text || '').slice(0, 20000);
  const insert = db.prepare('INSERT OR IGNORE INTO code_pairs (code_a, code_b, created_at) VALUES (?, ?, ?)');

  let added = 0;
  let skipped = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const parts = line.split(/[\s;,\t]+/).filter(Boolean);

    if (parts.length < 2) {
      skipped++;
      continue;
    }

    const a = normalizeCode(parts[0]);
    const b = normalizeCode(parts[1]);

    if (!a || !b || a === b) {
      skipped++;
      continue;
    }

    const info = insert.run(a, b, nowISO());
    if (info.changes > 0) added++;
    else skipped++;
  }

  rebuildPaintAliases();

  return { added, skipped };
});

route('DELETE', '/api/codes/:id', async ({ user, params }) => {
  if (!canManage(user)) throw new ApiError(403, 'Коды правит приёмщик или админ');

  db.prepare('DELETE FROM code_pairs WHERE id = ?').run(Number(params.id));
  rebuildPaintAliases();

  return { ok: true };
});

/* ---- Склад --------------------------------------------------------------- */

/** Склад видят все сотрудники: сколько чего есть на самом деле. */
route('GET', '/api/stock', async ({ url }) => {
  const q = normalizeSearch(str(url.searchParams.get('q'), 100));

  const rows = db.prepare(`
    SELECT m.code, m.name, m.unit, m.category, m.price, m.stock,
           COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = m.code), 0) AS used
      FROM materials m
     WHERE m.active = 1
     ORDER BY m.name
  `).all();

  const items = [];

  for (const row of rows) {
    if (q && !String(row.name).toLowerCase().includes(q) && !String(row.code).toLowerCase().includes(q)) {
      continue;
    }

    const stock = round2(Number(row.stock) || 0);
    const used = round2(Number(row.used) || 0);

    items.push({
      code: row.code,
      name: row.name,
      unit: row.unit,
      category: row.category,
      price: row.price,
      stock,
      used,
      left: round2(stock - used)
    });
  }

  return { items };
});

/** Остаток меняет кладовщик: вводит «сколько есть сейчас». */
route('PATCH', '/api/stock/:code', async ({ user, params, body }) => {
  if (!isStaff(user)) throw new ApiError(403, 'Остатки меняет кладовщик или админ');

  const material = db.prepare('SELECT * FROM materials WHERE code = ?').get(params.code);
  if (!material) throw new ApiError(404, 'Материал не найден');

  const used = db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM order_materials WHERE code = ?')
    .get(material.code).n;

  // В базе храним «сколько было на складе», кладовщик вводит «сколько осталось»
  const left = Math.max(0, toNum(body.left, 0));
  const stock = round2(left + (Number(used) || 0));

  db.prepare('UPDATE materials SET stock = ? WHERE code = ?').run(stock, material.code);

  audit(user.id, 'stock', 'material', null, {
    code: material.code,
    text: `Склад: «${material.name}» остаток ${left} ${material.unit}`
  });

  return { ok: true, left };
});

/** Новый материал на склад добавляет кладовщик или админ. */
route('POST', '/api/stock', async ({ user, body }) => {
  if (!isStaff(user)) throw new ApiError(403, 'Материалы добавляет кладовщик или админ');

  const name = str(body.name, 300);
  if (!name) throw new ApiError(400, 'Укажите наименование');

  const code = str(body.code, 40) || `MAN-${Date.now().toString(36).toUpperCase()}`;
  const unit = str(body.unit, 10) || 'шт';
  const category = str(body.category, 30) || 'other';
  const price = round2(toNum(body.price, 0));
  const stock = Math.max(0, toNum(body.stock, 0));

  const exists = db.prepare('SELECT code FROM materials WHERE code = ?').get(code);
  if (exists) throw new ApiError(400, 'Такой код уже есть');

  db.prepare(`INSERT INTO materials (code, name, unit, category, price, stock, active, synced_at, search)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(code, name, unit, category, price, stock, nowISO(), normalizeSearch(code, name));

  audit(user.id, 'create', 'material', null, { text: `На склад добавлен «${name}»` });

  return { ok: true, code };
});

/* ---- Нормы списания: на деталь и на машину ------------------------------- */

function normRows(ownerId) {
  return db.prepare(`
    SELECT n.id, n.owner_id, n.code, n.role, n.qty, n.unit, n.per, n.sort,
           COALESCE(m.name, '') AS name
      FROM norm_items n
      LEFT JOIN materials m ON m.code = n.code
     WHERE n.owner_id ${ownerId === null ? 'IS NULL' : '= ?'}
     ORDER BY n.sort, n.id
  `).all(...(ownerId === null ? [] : [ownerId]));
}

/** Свои нормы маляра или общая база — что применяется сейчас. */
function effectiveNorms(user) {
  const mine = normRows(Number(user.id));
  if (mine.length) return { items: mine, personal: true };

  return { items: normRows(null), personal: false };
}

route('GET', '/api/norm-set', async ({ user }) => {
  const mine = normRows(Number(user.id));

  return {
    common: normRows(null),
    mine,
    personal: mine.length > 0,
    can_edit_common: canManage(user)
  };
});

/** Сохраняем набор норм: свой личный или общий. */
route('PUT', '/api/norm-set', async ({ user, body }) => {
  const scope = body.scope === 'common' ? 'common' : 'mine';

  if (scope === 'common' && !canManage(user)) {
    throw new ApiError(403, 'Общую базу меняет приёмщик или админ');
  }

  const ownerId = scope === 'common' ? null : Number(user.id);
  const items = Array.isArray(body.items) ? body.items : [];

  db.exec('BEGIN');

  try {
    if (ownerId === null) db.prepare('DELETE FROM norm_items WHERE owner_id IS NULL').run();
    else db.prepare('DELETE FROM norm_items WHERE owner_id = ?').run(ownerId);

    const insert = db.prepare(`INSERT INTO norm_items (owner_id, code, role, qty, unit, per, sort)
                               VALUES (?, ?, ?, ?, ?, ?, ?)`);

    items.forEach((item, index) => {
      const role = item.role === 'paint' ? 'paint' : 'material';
      const code = role === 'paint' ? '' : str(item.code, 40);
      const qty = round2(toNum(item.qty, 0));

      if (!(qty > 0)) return;
      if (role !== 'paint' && !code) return;

      insert.run(ownerId, code, role, qty, str(item.unit, 10) || 'г',
        item.per === 'order' ? 'order' : 'part', index);
    });

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  audit(user.id, 'update', 'norms', scope, { text: `Нормы списания (${scope}), позиций: ${items.length}` });

  return { ok: true };
});

/** Вернуться к общей базе: удалить личные нормы. */
route('DELETE', '/api/norm-set', async ({ user }) => {
  db.prepare('DELETE FROM norm_items WHERE owner_id = ?').run(Number(user.id));
  return { ok: true };
});

/** Быстрый набор: что уйдёт на N деталей и на машину целиком. */
route('GET', '/api/norms/quick', async ({ user, url }) => {
  const parts = Math.max(0.01, toNum(url.searchParams.get('parts'), 1));
  const paintCode = str(url.searchParams.get('paint'), 40).toUpperCase();

  const { items, personal } = effectiveNorms(user);
  const rows = [];

  for (const norm of items) {
    const factor = norm.per === 'order' ? 1 : parts;
    const qty = round2(Number(norm.qty) * factor);

    // Строка «краска» — подставляем выбранную в наряде краску
    let code = norm.code;
    let name = norm.name;

    if (norm.role === 'paint') {
      if (!paintCode) continue;

      const material = db.prepare('SELECT code, name FROM materials WHERE upper(code) = ?').get(paintCode);
      if (!material) continue;

      code = material.code;
      name = material.name;
    }

    const stock = db.prepare(`
      SELECT m.stock, m.unit,
             COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = m.code), 0) AS used
        FROM materials m WHERE m.code = ?
    `).get(code);

    rows.push({
      code,
      name,
      unit: norm.unit || (stock && stock.unit) || 'г',
      qty,
      per: norm.per,
      role: norm.role,
      left_after: stock
        ? round2((Number(stock.stock) || 0) - (Number(stock.used) || 0) - qty)
        : null
    });
  }

  return { parts, personal, items: rows };
});

/* ---- Нормы по работам (старая модель, оставлено для совместимости) ------- */

route('GET', '/api/norms', async ({ url }) => {
  const workId = Number(url.searchParams.get('work_id')) || 0;
  if (!workId) throw new ApiError(400, 'Не указана работа');

  const norms = db.prepare(`
    SELECT n.code, n.qty, n.unit, m.name
      FROM norms n
      LEFT JOIN materials m ON m.code = n.code
     WHERE n.work_id = ?
     ORDER BY m.name
  `).all(workId);

  return { norms };
});

/** Нормы задаёт приёмщик или админ: список заменяется целиком. */
route('PUT', '/api/norms', async ({ user, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'Нормы задаёт приёмщик или админ');

  const workId = Number(body.work_id) || 0;
  if (!workId) throw new ApiError(400, 'Не указана работа');

  const items = Array.isArray(body.items) ? body.items : [];

  db.exec('BEGIN');

  try {
    db.prepare('DELETE FROM norms WHERE work_id = ?').run(workId);

    for (const item of items) {
      const code = str(item.code, 40);
      const qty = round2(toNum(item.qty, 0));
      if (!code || !(qty > 0)) continue;

      db.prepare('INSERT INTO norms (work_id, code, qty, unit) VALUES (?, ?, ?, ?)')
        .run(workId, code, qty, str(item.unit, 10) || 'г');
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  audit(user.id, 'update', 'norms', workId, { text: `Нормы расхода, позиций: ${items.length}` });

  return { ok: true };
});

/* ---- Техническая документация (ТДС) -------------------------------------- */

/** Все документы одним списком: их немного, отдаём целиком. */
route('GET', '/api/tds', async () => {
  const docs = db.prepare(`
    SELECT d.id, d.code, d.title, d.url, d.created_at, m.name
      FROM material_docs d
      LEFT JOIN materials m ON m.code = d.code
     ORDER BY m.name, d.created_at DESC
  `).all();

  return { docs };
});

/** Ссылку на ТДС добавляет кладовщик, приёмщик или админ. */
route('POST', '/api/tds', async ({ user, body }) => {
  if (!canEditDocs(user)) throw new ApiError(403, 'Документы добавляют маляры, приёмщик или админ');

  const code = str(body.code, 40);
  const title = str(body.title, 200);
  const url = str(body.url, 500);

  if (!code) throw new ApiError(400, 'Не указан материал');
  if (!title) throw new ApiError(400, 'Укажите название документа');
  if (!/^https?:\/\/\S+$/i.test(url)) throw new ApiError(400, 'Ссылка должна начинаться с http:// или https://');

  const info = db.prepare('INSERT INTO material_docs (code, title, url, created_at) VALUES (?, ?, ?, ?)')
    .run(code, title, url, nowISO());

  audit(user.id, 'create', 'material_doc', Number(info.lastInsertRowid), { text: `ТДС: ${title}` });

  return { ok: true, id: Number(info.lastInsertRowid) };
});

/** Файл ТДС (PDF или картинка) — сохраняем на сервере и отдаём по ссылке. */
route('POST', '/api/tds/file', async ({ user, body }) => {
  if (!canEditDocs(user)) throw new ApiError(403, 'Документы добавляют маляры, приёмщик или админ');

  const code = str(body.code, 40);
  const title = str(body.title, 200);
  const raw = String(body.file || '');

  if (!code) throw new ApiError(400, 'Не указан материал');
  if (!title) throw new ApiError(400, 'Укажите название документа');

  const match = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(raw);
  if (!match) throw new ApiError(400, 'Не удалось прочитать файл');

  const mime = match[1].toLowerCase();
  const ext = DOC_EXT[mime];

  if (!ext) throw new ApiError(400, 'Подойдёт PDF, JPEG, PNG или WebP');

  const data = Buffer.from(match[2], 'base64');
  if (!data.length) throw new ApiError(400, 'Пустой файл');
  if (data.length > MAX_DOC_BYTES) {
    throw new ApiError(413, `Файл больше ${Math.round(MAX_DOC_BYTES / 1024 / 1024)} МБ`);
  }

  const dir = path.join(UPLOAD_DIR, 'docs');
  fs.mkdirSync(dir, { recursive: true });

  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), data);

  const url = '/api/tds/file/' + name;

  const info = db.prepare('INSERT INTO material_docs (code, title, url, created_at) VALUES (?, ?, ?, ?)')
    .run(code, title, url, nowISO());

  audit(user.id, 'create', 'material_doc', Number(info.lastInsertRowid), { text: `ТДС файлом: ${title}` });

  return { ok: true, id: Number(info.lastInsertRowid), url };
});

/** Выдача файлов ТДС: открываются в браузере, PDF — во встроенном просмотрщике. */
route('GET', '/api/tds/file/:name', async ({ params, res }) => {
  const name = path.basename(String(params.name || ''));

  if (!/^[\w.-]+\.(pdf|jpe?g|png|webp)$/i.test(name)) {
    throw new ApiError(404, 'Файл не найден');
  }

  const file = path.join(UPLOAD_DIR, 'docs', name);
  if (!fs.existsSync(file)) throw new ApiError(404, 'Файл не найден');

  const ext = path.extname(name).toLowerCase();
  const type = ext === '.pdf' ? 'application/pdf'
    : ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : 'image/jpeg';

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Disposition': `inline; filename="${name}"`,
    'Cache-Control': 'private, max-age=604800'
  });

  fs.createReadStream(file).pipe(res);
});

route('DELETE', '/api/tds/:id', async ({ user, params }) => {
  if (!canEditDocs(user)) throw new ApiError(403, 'Удаляют маляры, приёмщик или админ');

  db.prepare('DELETE FROM material_docs WHERE id = ?').run(Number(params.id));
  return { ok: true };
});

/* ---- ИИ-помощник --------------------------------------------------------- */

/** Настроен ли помощник и сколько запросов уже израсходовано. */
route('GET', '/api/ai/status', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const used = db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'ai' AND at >= ?").get(today).n;
  const limit = Number(process.env.AI_DAILY_LIMIT || 300);

  return {
    configured: ai.configured(),
    model: ai.MODEL,
    used_today: used,
    limit_today: limit
  };
});

/** Диалог с помощником. Запись в базу делает человек кнопкой, не модель. */
route('POST', '/api/ai/chat', async ({ user, body }) => {
  if (!ai.configured()) {
    throw new ApiError(503, 'ИИ-помощник не настроен: на сервере нет ключа DeepSeek');
  }

  const today = new Date().toISOString().slice(0, 10);
  const used = db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'ai' AND at >= ?").get(today).n;
  const limit = Number(process.env.AI_DAILY_LIMIT || 300);

  if (used >= limit) {
    throw new ApiError(429, `Дневной лимит запросов к помощнику исчерпан (${limit}). Попробуйте завтра.`);
  }

  const message = str(body.message, 2000);
  if (!message) throw new ApiError(400, 'Пустой запрос');

  const result = await aiAgent.handle(
    { db, user, canSeeOrder, orderView, round2 },
    { message, history: body.history, orderId: body.order_id ? Number(body.order_id) : null }
  );

  audit(user.id, 'ai', 'chat', null, {
    text: message.slice(0, 300),
    tokens: result.usage ? result.usage.prompt_tokens + result.usage.completion_tokens : 0
  });

  return {
    reply: result.reply,
    proposal: result.proposal || null,
    opened: result.opened || null,
    usage: result.usage || null
  };
});

/* ---- Готовые краски ----------------------------------------------------- */

const recipeOut = (row) => ({ ...row, mixes: JSON.parse(row.mixes || '[]') });

route('GET', '/api/recipes', async () => {
  const recipes = db.prepare('SELECT * FROM recipes ORDER BY name').all().map(recipeOut);
  return { recipes };
});

function validateRecipe(body) {
  const name = str(body.name, 200);
  const base = round2(toNum(body.base, 100));
  const unit = str(body.unit, 10) || 'г';
  const mixes = (Array.isArray(body.mixes) ? body.mixes : [])
    .map((m) => ({
      code: str(m.code, 40) || '—',
      name: str(m.name, 300),
      amount: round2(toNum(m.amount, 0))
    }))
    .filter((m) => m.name && m.amount > 0);

  if (!name) throw new ApiError(400, 'Укажите название цвета');
  if (!(base > 0)) throw new ApiError(400, 'База состава должна быть больше нуля');
  if (!mixes.length) throw new ApiError(400, 'Добавьте хотя бы один микс');

  return { name, base, unit, mixes };
}

route('POST', '/api/recipes', async ({ user, body }) => {
  const data = validateRecipe(body);
  const id = `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  db.prepare('INSERT INTO recipes (id, name, base, unit, mixes, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, data.name, data.base, data.unit, JSON.stringify(data.mixes), nowISO());

  audit(user.id, 'create', 'recipe', id, { name: data.name });
  return { id };
});

route('PUT', '/api/recipes/:id', async ({ user, params, body }) => {
  const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(params.id);
  if (!existing) throw new ApiError(404, 'Краска не найдена');

  const data = validateRecipe(body);

  db.prepare('UPDATE recipes SET name = ?, base = ?, unit = ?, mixes = ?, updated_at = ? WHERE id = ?')
    .run(data.name, data.base, data.unit, JSON.stringify(data.mixes), nowISO(), existing.id);

  audit(user.id, 'update', 'recipe', existing.id, { name: data.name });
  return { ok: true };
});

route('DELETE', '/api/recipes/:id', async ({ user, params }) => {
  if (!canManage(user)) throw new ApiError(403, 'Удалять краски может приёмщик или админ');

  db.prepare('DELETE FROM recipes WHERE id = ?').run(params.id);
  audit(user.id, 'delete', 'recipe', params.id, null);

  return { ok: true };
});

/* --------------------------------------------------------------------------
   Пользователи (админ)
   -------------------------------------------------------------------------- */

/* ---- Названия ролей: как их видит цех ------------------------------------ */

const DEFAULT_ROLE_LABELS = {
  admin: 'администратор',
  manager: 'приёмщик',
  painter: 'маляр',
  bodyworker: 'кузовщик',
  store: 'склад',
  workstation: 'рабочее место'
};

function roleLabels() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'role_labels'").get();

  let custom = {};
  try {
    if (row && row.value) custom = JSON.parse(row.value) || {};
  } catch (error) {
    custom = {};
  }

  const result = { ...DEFAULT_ROLE_LABELS };
  for (const key of Object.keys(DEFAULT_ROLE_LABELS)) {
    if (typeof custom[key] === 'string' && custom[key].trim()) result[key] = custom[key].trim();
  }

  return result;
}

route('GET', '/api/settings/roles', async ({ user }) => {
  if (!canManage(user)) throw new ApiError(403, 'Нет прав');
  return { labels: roleLabels(), defaults: DEFAULT_ROLE_LABELS };
});

route('PUT', '/api/settings/roles', async ({ user, body }) => {
  if (user.role !== 'admin') throw new ApiError(403, 'Названия ролей меняет администратор');

  const incoming = body.labels || {};
  const next = {};

  for (const key of Object.keys(DEFAULT_ROLE_LABELS)) {
    const value = str(incoming[key], 40);
    if (value) next[key] = value;
  }

  db.prepare(`INSERT INTO settings (key, value) VALUES ('role_labels', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(JSON.stringify(next));

  audit(user.id, 'update', 'settings', 'role_labels', next);

  return { labels: roleLabels() };
});

route('GET', '/api/users', async ({ user }) => {
  if (!canManage(user)) throw new ApiError(403, 'Нет прав');

  const users = db.prepare(`
    SELECT id, login, full_name, role, active, created_at, is_workstation, specialty,
           CASE WHEN pin_hash IS NULL THEN 0 ELSE 1 END AS pin_set
      FROM users
     ORDER BY is_workstation, role, specialty, full_name
  `).all();

  return { users };
});

route('POST', '/api/users', async ({ user, body }) => {
  if (user.role !== 'admin') throw new ApiError(403, 'Пользователей заводит администратор');

  const login = str(body.login, 60).toLowerCase();
  const full_name = str(body.full_name, 120);
  const password = String(body.password ?? '');

  // «Рабочее место мастеров» — обычная учётка с пометкой: пароль общий, вход по ПИНам
  const wanted = str(body.role, 20);
  const isWorkstation = wanted === 'workstation' || body.is_workstation ? 1 : 0;
  const isBodyworker = wanted === 'bodyworker';

  const role = isWorkstation || isBodyworker ? 'master' : wanted;
  const specialty = isWorkstation ? null : (isBodyworker ? 'bodyworker' : (role === 'master' ? 'painter' : null));

  if (!login || !full_name) throw new ApiError(400, 'Укажите логин и ФИО');
  if (password.length < 6) throw new ApiError(400, 'Пароль короче 6 символов');
  if (!['admin', 'manager', 'master', 'store'].includes(role)) throw new ApiError(400, 'Неизвестная роль');

  const exists = db.prepare('SELECT id FROM users WHERE lower(login) = ?').get(login);
  if (exists) throw new ApiError(400, 'Такой логин уже занят');

  const info = db.prepare(`INSERT INTO users (login, pass_hash, full_name, role, active, created_at, search, is_workstation, specialty)
                           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`)
    .run(login, hashPassword(password), full_name, role, nowISO(), normalizeSearch(full_name), isWorkstation, specialty);

  const id = Number(info.lastInsertRowid);

  // ПИН можно задать сразу — только маляру
  if (body.pin && role === 'master' && specialty === 'painter') {
    setPin(id, body.pin);
  }

  audit(user.id, 'create', 'user', id, { login, role, specialty, isWorkstation });

  // Новый сотрудник не должен видеть историю старых заказов как «непрочитанные изменения»
  db.prepare(`INSERT OR IGNORE INTO order_reads (user_id, order_id, seen_at)
              SELECT ?, id, ? FROM orders`).run(id, nowISO());

  return { id };
});

/* --------------------------------------------------------------------------
   ПИН-коды мастеров
   -------------------------------------------------------------------------- */

/** Установка ПИНа: только 4 цифры и только уникальный. */
function setPin(userId, rawPin) {
  const pin = String(rawPin ?? '').replace(/\D/g, '');
  if (pin.length !== 4) throw new ApiError(400, 'ПИН-код — четыре цифры');

  const others = db.prepare('SELECT id, full_name, pin_hash FROM users WHERE pin_hash IS NOT NULL AND id <> ?').all(userId);
  const busy = others.find((other) => verifyPassword(pin, other.pin_hash));

  if (busy) throw new ApiError(400, `Такой ПИН уже у ${busy.full_name} — нужен уникальный`);

  db.prepare('UPDATE users SET pin_hash = ?, pin_updated_at = ? WHERE id = ?')
    .run(hashPassword(pin), nowISO(), userId);
}

route('POST', '/api/users/:id/pin', async ({ user, params, body }) => {
  if (!canManage(user)) throw new ApiError(403, 'ПИН-коды задаёт приёмщик или администратор');

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id));
  if (!target) throw new ApiError(404, 'Пользователь не найден');

  const isPainter = target.role === 'master' && !target.is_workstation
    && (target.specialty || 'painter') === 'painter';

  if (!isPainter) throw new ApiError(400, 'ПИН-код бывает только у маляра');

  setPin(target.id, body.pin);
  audit(user.id, 'pin', 'user', target.id, { text: `Задан ПИН-код мастеру ${target.full_name}` });

  return { ok: true };
});

route('PATCH', '/api/users/:id', async ({ user, params, body }) => {
  if (user.role !== 'admin') throw new ApiError(403, 'Пользователей правит администратор');

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id));
  if (!target) throw new ApiError(404, 'Пользователь не найден');

  // Роль в интерфейсе может быть «кузовщик» — это мастер с другой специальностью
  const wanted = body.role !== undefined ? str(body.role, 20) : null;

  let role = target.role;
  let specialty = target.specialty;

  if (wanted === 'bodyworker') {
    role = 'master';
    specialty = 'bodyworker';
  } else if (wanted === 'master') {
    role = 'master';
    specialty = target.specialty === 'bodyworker' ? 'painter' : (target.specialty || 'painter');
  } else if (wanted) {
    role = wanted;
    if (role !== 'master') specialty = null;
  }

  if (!['admin', 'manager', 'master', 'store'].includes(role)) throw new ApiError(400, 'Неизвестная роль');

  const active = body.active !== undefined ? (body.active ? 1 : 0) : target.active;

  if (target.id === user.id && !active) throw new ApiError(400, 'Нельзя отключить самого себя');
  if (target.id === user.id && role !== 'admin') throw new ApiError(400, 'Нельзя снять с себя права администратора');

  const fullName = body.full_name !== undefined ? str(body.full_name, 120) : target.full_name;

  db.prepare('UPDATE users SET full_name = ?, role = ?, specialty = ?, active = ?, search = ? WHERE id = ?')
    .run(fullName, role, specialty, active, normalizeSearch(fullName), target.id);

  if (body.password) {
    if (String(body.password).length < 6) throw new ApiError(400, 'Пароль короче 6 символов');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(body.password), target.id);
  }

  audit(user.id, 'update', 'user', target.id, { role, specialty, active });

  return { ok: true };
});

/* --------------------------------------------------------------------------
   Отчёты
   -------------------------------------------------------------------------- */

function period(query) {
  const to = str(query.get('to'), 10) || new Date().toISOString().slice(0, 10);
  const from = str(query.get('from'), 10) || `${to.slice(0, 7)}-01`;
  return { from, to };
}

route('GET', '/api/reports/summary', async ({ user, url }) => {
  if (!canManage(user) && user.role !== 'store') throw new ApiError(403, 'Отчёты — для начальства');

  const { from, to } = period(url.searchParams);

  const orders = db.prepare(`
    SELECT o.id, o.master_id, o.status, u.full_name AS master_name,
           (SELECT COALESCE(SUM(qty * price), 0) FROM order_works w WHERE w.order_id = o.id) AS works_sum,
           (SELECT COALESCE(SUM(qty * price), 0) FROM order_materials om WHERE om.order_id = o.id) AS materials_sum
      FROM orders o
      LEFT JOIN users u ON u.id = o.master_id
     WHERE substr(o.created_at, 1, 10) BETWEEN ? AND ?
       AND o.status <> 'cancelled'
  `).all(from, to);

  const byMaster = new Map();

  for (const order of orders) {
    const key = order.master_id || 0;
    const item = byMaster.get(key) || {
      master_id: order.master_id, master_name: order.master_name || 'Без мастера',
      orders: 0, closed: 0, ready: 0, in_work: 0,
      works_sum: 0, materials_sum: 0
    };

    item.orders++;
    if (order.status === 'closed') item.closed++;
    else if (order.status === 'ready') item.ready++;
    else item.in_work++;

    item.works_sum = round2(item.works_sum + order.works_sum);
    item.materials_sum = round2(item.materials_sum + order.materials_sum);
    byMaster.set(key, item);
  }

  const materials = db.prepare(`
    SELECT om.code, om.name, om.unit,
           SUM(om.qty) AS qty,
           SUM(om.qty * om.price) AS cost
      FROM order_materials om
      JOIN orders o ON o.id = om.order_id
     WHERE substr(o.created_at, 1, 10) BETWEEN ? AND ?
       AND o.status <> 'cancelled'
     GROUP BY om.code, om.name, om.unit
     ORDER BY cost DESC
     LIMIT 100
  `).all(from, to).map((row) => ({ ...row, cost: round2(row.cost), qty: round2(row.qty) }));

  const totals = {
    orders: orders.length,
    works_sum: round2(orders.reduce((acc, o) => acc + o.works_sum, 0)),
    materials_sum: round2(orders.reduce((acc, o) => acc + o.materials_sum, 0))
  };
  totals.total = round2(totals.works_sum + totals.materials_sum);

  return {
    from, to,
    masters: [...byMaster.values()].map((row) => ({ ...row, total: round2(row.works_sum + row.materials_sum) })),
    materials,
    totals
  };
});

/* --------------------------------------------------------------------------
   Фотографии

   Файлы лежат на диске, в базе — только описание. Смотреть может лишь тот,
   кому виден заказ: чужие снимки по прямой ссылке не откроются.
   -------------------------------------------------------------------------- */

const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function photoView(row) {
  return {
    id: row.id,
    order_id: row.order_id,
    channel: row.channel,
    user_id: row.user_id,
    created_at: row.created_at,
    url: '/api/photos/' + row.id
  };
}

/** Доступ к снимку: только через заказ, к которому он прикреплён. */
function photoFor(user, rawId) {
  const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(rawId));
  if (!row) throw new ApiError(404, 'Фотография не найдена');

  let orderId = row.order_id;

  if (!orderId && row.channel && row.channel.startsWith('order:')) {
    orderId = Number(row.channel.split(':')[1]);
  }

  if (orderId) {
    const order = orderView(orderId);
    if (!order || !canSeeOrder(user, order)) throw new ApiError(403, 'Нет доступа к этой фотографии');
  }

  return row;
}

route('POST', '/api/photos', async ({ user, body }) => {
  const raw = String(body.image || '');
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(raw);
  if (!match) throw new ApiError(400, 'Не удалось прочитать изображение');

  const mime = match[1].toLowerCase();
  if (!PHOTO_EXT[mime]) throw new ApiError(400, 'Подойдёт JPEG, PNG или WebP');

  const data = Buffer.from(match[2], 'base64');
  if (!data.length) throw new ApiError(400, 'Пустой файл');
  if (data.length > MAX_PHOTO_BYTES) throw new ApiError(413, 'Фотография больше 6 МБ');

  let orderId = null;
  let channel = null;

  if (body.orderId) {
    const order = orderView(body.orderId);
    if (!order) throw new ApiError(404, 'Заказ не найден');
    if (!canSeeOrder(user, order)) throw new ApiError(403, 'Это не ваш заказ');
    orderId = order.id;
  } else if (body.channel) {
    const resolved = resolveChannel(user, body.channel);
    channel = resolved.channel;
    orderId = resolved.order ? resolved.order.id : null;
  } else {
    throw new ApiError(400, 'Не указано, к чему прикрепить фотографию');
  }

  const file = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${PHOTO_EXT[mime]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), data);

  const info = db.prepare(`INSERT INTO photos (user_id, order_id, channel, file, mime, bytes, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(user.id, orderId, channel, file, mime, data.length, nowISO());

  const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(info.lastInsertRowid));

  if (orderId) audit(user.id, 'photo_add', 'order', orderId, { photo: row.id, text: 'Добавлена фотография' });
  else audit(user.id, 'photo_add', 'chat', row.id, { channel });

  return { photo: photoView(row) };
});

route('GET', '/api/photos/:id', async ({ user, params, res }) => {
  const row = photoFor(user, params.id);
  const file = path.join(UPLOAD_DIR, row.file);

  if (!fs.existsSync(file)) throw new ApiError(404, 'Файл не найден');

  const data = fs.readFileSync(file);

  res.writeHead(200, {
    'Content-Type': row.mime,
    'Content-Length': data.length,
    'Cache-Control': 'private, max-age=86400'
  });
  res.end(data);

  return { __raw: true };
});

route('DELETE', '/api/photos/:id', async ({ user, params }) => {
  const row = photoFor(user, params.id);

  if (row.user_id !== user.id && user.role !== 'admin') {
    throw new ApiError(403, 'Удалять может только тот, кто загрузил');
  }

  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, row.file));
  } catch (error) {
    /* файла уже нет — не беда */
  }

  db.prepare('DELETE FROM photos WHERE id = ?').run(row.id);

  return { ok: true };
});

route('GET', '/api/orders/:id/photos', async ({ user, params }) => {
  const order = orderView(params.id);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  if (!canSeeOrder(user, order)) throw new ApiError(403, 'Это не ваш заказ');

  const rows = db.prepare(`
    SELECT p.*, u.full_name AS user_name
      FROM photos p
      LEFT JOIN users u ON u.id = p.user_id
     WHERE p.order_id = ? AND (p.channel IS NULL OR p.channel = '')
     ORDER BY p.id DESC
  `).all(order.id);

  return {
    photos: rows.map((row) => ({ ...photoView(row), user_name: row.user_name }))
  };
});

/* --------------------------------------------------------------------------
   Внутренний чат

   Канал 'general' — общий, 'order:12' — обсуждение конкретного заказа.
   Сообщения никогда не удаляются: это та самая история договорённостей.
   -------------------------------------------------------------------------- */

function resolveChannel(user, raw) {
  const value = str(raw, 40) || 'general';

  if (value === 'general') return { channel: 'general', order: null };

  const match = /^order:(\d+)$/.exec(value);
  if (!match) throw new ApiError(400, 'Неизвестный канал чата');

  const order = orderView(match[1]);
  if (!order) throw new ApiError(404, 'Заказ не найден');
  if (!canSeeOrder(user, order)) throw new ApiError(403, 'Это не ваш заказ');

  return { channel: `order:${order.id}`, order };
}

function messageView(row) {
  return {
    id: row.id,
    channel: row.channel,
    body: row.body,
    user_id: row.user_id,
    user_name: row.user_name || 'система',
    role: row.role || '',
    created_at: row.created_at,
    photo_id: row.photo_id || null,
    photo_url: row.photo_id ? '/api/photos/' + row.photo_id : null
  };
}

route('GET', '/api/chat', async ({ user, url }) => {
  const { channel } = resolveChannel(user, url.searchParams.get('channel'));
  const after = Number(url.searchParams.get('after')) || 0;

  const rows = db.prepare(`
    SELECT m.*, u.full_name AS user_name, u.role
      FROM messages m
      LEFT JOIN users u ON u.id = m.user_id
     WHERE m.channel = ? ${after ? 'AND m.id > ?' : ''}
     ORDER BY m.id ASC
     LIMIT 300
  `).all(...(after ? [channel, after] : [channel]));

  return { channel, messages: rows.map(messageView) };
});

route('POST', '/api/chat', async ({ user, body }) => {
  const { channel } = resolveChannel(user, body.channel);
  const text = str(body.body, 2000);
  const photoId = body.photo_id ? Number(body.photo_id) : null;

  if (!text && !photoId) throw new ApiError(400, 'Сообщение пустое');

  let photo = null;
  if (photoId) {
    photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);

    if (!photo) throw new ApiError(404, 'Фотография не найдена');
    if (photo.user_id !== user.id) throw new ApiError(403, 'Это чужая фотография');
    if (photo.channel !== channel) throw new ApiError(400, 'Фотография из другого чата');
  }

  const info = db.prepare('INSERT INTO messages (channel, user_id, body, photo_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(channel, user.id, text, photo ? photo.id : null, nowISO());

  const row = db.prepare(`
    SELECT m.*, u.full_name AS user_name, u.role
      FROM messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.id = ?`).get(Number(info.lastInsertRowid));

  return { message: messageView(row) };
});

route('POST', '/api/chat/read', async ({ user, body }) => {
  const { channel } = resolveChannel(user, body.channel);
  const lastId = Number(body.lastId) || 0;

  db.prepare(`INSERT INTO chat_reads (user_id, channel, last_id) VALUES (?, ?, ?)
              ON CONFLICT(user_id, channel) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`)
    .run(user.id, channel, lastId);

  return { ok: true };
});

route('GET', '/api/chat/unread', async ({ user }) => {
  const reads = new Map();
  for (const row of db.prepare('SELECT channel, last_id FROM chat_reads WHERE user_id = ?').all(user.id)) {
    reads.set(row.channel, row.last_id);
  }

  const channels = db.prepare('SELECT channel FROM messages GROUP BY channel').all();

  let total = 0;
  const perChannel = {};

  for (const item of channels) {
    if (item.channel !== 'general') {
      const match = /^order:(\d+)$/.exec(item.channel);
      if (!match) continue;

      const order = orderView(match[1]);
      if (!order || !canSeeOrder(user, order)) continue;
    }

    const since = reads.get(item.channel) || 0;
    const count = db.prepare(`
      SELECT COUNT(*) AS n FROM messages
       WHERE channel = ? AND id > ? AND (user_id IS NULL OR user_id <> ?)
    `).get(item.channel, since, user.id).n;

    if (count > 0) {
      perChannel[item.channel] = count;
      total += count;
    }
  }

  // Плюс важные изменения заказов, которые человек ещё не видел
  const masterScope = user.role === 'master' ? 'AND (o.master_id = ? OR o.bodyworker_id = ?)' : '';
  const masterParams = user.role === 'master' ? [user.id, user.id] : [];

  const changes = db.prepare(`
    SELECT COUNT(*) AS n
      FROM audit a
      JOIN orders o ON CAST(o.id AS TEXT) = a.entity_id
     WHERE a.entity = 'order'
       AND a.user_id <> ?
       AND a.action IN ('create', 'change', 'work_add', 'work_edit', 'work_remove', 'photo_add')
       AND a.at > COALESCE((SELECT r.seen_at FROM order_reads r WHERE r.user_id = ? AND r.order_id = o.id), '')
       ${masterScope}
  `).get(user.id, user.id, ...masterParams).n;

  return { total, channels: perChannel, changes };
});

/* --------------------------------------------------------------------------
   Сводка для главного экрана
   -------------------------------------------------------------------------- */

route('GET', '/api/dashboard', async ({ user }) => {
  const scope = user.role === 'master' ? ' AND master_id = ?' : '';
  const params = user.role === 'master' ? [user.id] : [];

  const counts = {};
  for (const status of ['accepted', 'in_work', 'ready', 'closed']) {
    counts[status] = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = ?${scope}`)
      .get(status, ...params).n;
  }

  return { counts };
});

/* --------------------------------------------------------------------------
   Статика
   -------------------------------------------------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const target = path.join(PUBLIC_DIR, path.normalize(relative).replace(/^(\.\.[\\/])+/, ''));

  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Запрещено');
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Файл не найден');
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/* --------------------------------------------------------------------------
   Обработка запроса
   -------------------------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    // Проверка живости — для мониторинга и внешних проверок, без входа
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('ok');
      return;
    }

    if (pathname.startsWith('/api/')) {
      const found = matchRoute(req.method, pathname);
      if (!found) throw new ApiError(404, 'Нет такого метода API');

      const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE_NAME];
      const sessionData = auth.loadSession(token);

      let user = null;
      let locked = false;

      if (sessionData) {
        if (sessionData.account.is_workstation) {
          if (sessionData.activeUserId) {
            const idle = Date.now() - new Date(sessionData.lastSeen || 0).getTime();

            if (idle > IDLE_MS) {
              // Бездействие — закрываем кабинет, данные не теряются
              auth.lockSession(token);
              locked = true;
            } else {
              const master = db.prepare('SELECT id, login, full_name, role FROM users WHERE id = ? AND active = 1')
                .get(sessionData.activeUserId);

              if (master) {
                user = { ...master, is_workstation: false };
                auth.touchSession(token);
              } else {
                locked = true;
              }
            }
          } else {
            locked = true;
          }
        } else if (sessionData.account.active) {
          user = sessionData.account;
        }
      }

      // Эти запросы работают и на запертом рабочем месте — иначе с него не выйти
      const alwaysAllowed = ['/api/login', '/api/unlock', '/api/lock', '/api/me', '/api/logout'].includes(pathname);

      if (!alwaysAllowed && !user) {
        if (sessionData && sessionData.account.is_workstation) {
          throw new ApiError(423, 'Кабинет закрыт — введите ПИН-код');
        }
        throw new ApiError(401, 'Нужно войти');
      }

      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};

      const result = await found.handler({
        req, res, url, params: found.params, body, user, sessionData, token, locked
      });

      if (result && result.__raw) return;

      json(res, 200, result ?? { ok: true });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Метод не поддерживается');
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;

    if (status >= 500) {
      console.error('[ошибка]', req.method, pathname, error);
    }

    if (!res.headersSent) {
      json(res, status, { error: error.message || 'Внутренняя ошибка' });
    } else {
      res.end();
    }
  }
});

/* --------------------------------------------------------------------------
   Запуск
   -------------------------------------------------------------------------- */

const seeded = init();
auth.cleanupSessions();

// Двойные названия красок (Brulex ↔ Standox) собираем из таблицы соответствий
rebuildPaintAliases();

/** Адреса, по которым сервер виден из локальной сети — для входа с телефона. */
function localAddresses() {
  const result = [];

  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address);
    }
  }

  return result;
}

server.listen(PORT, HOST, () => {
  console.log(`\n  Лонжерон — CRM малярного цеха, сервер запущен`);
  console.log(`  На этом компьютере: http://localhost:${PORT}`);

  const addresses = localAddresses();
  if (addresses.length) {
    console.log(`  С телефона или другого ПК:`);
    for (const address of addresses) console.log(`    http://${address}:${PORT}`);
  }

  console.log(`  База:    ${require('./db').DB_PATH}`);

  if (seeded.materials) console.log(`  Загружено материалов: ${seeded.materials}`);
  if (seeded.works) console.log(`  Загружено работ: ${seeded.works}`);
  if (seeded.admin) {
    console.log(`\n  Первый вход: ${seeded.admin.login} / ${seeded.admin.password}`);
    console.log(`  Смените пароль после входа.\n`);
  }
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
