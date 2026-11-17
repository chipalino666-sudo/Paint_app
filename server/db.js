'use strict';

/* ==========================================================================
   База данных: схема, миграции, первичное наполнение.
   SQLite из стандартной библиотеки Node (node:sqlite) — внешних зависимостей нет.
   ========================================================================== */

const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.PAINT_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.PAINT_DB || path.join(DATA_DIR, 'paint.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* --------------------------------------------------------------------------
   Схема
   -------------------------------------------------------------------------- */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  login       TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','manager','master','store')),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cars (
  id           INTEGER PRIMARY KEY,
  plate        TEXT NOT NULL,
  vin          TEXT,
  make         TEXT,
  model        TEXT,
  color        TEXT,
  color_code   TEXT,
  owner_name   TEXT,
  owner_phone  TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cars_plate_idx ON cars(plate);

CREATE TABLE IF NOT EXISTS works (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  category  TEXT,
  price     REAL NOT NULL DEFAULT 0,
  unit      TEXT NOT NULL DEFAULT 'шт',
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS materials (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'шт',
  category   TEXT,
  price      REAL NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  synced_at  TEXT
);
CREATE INDEX IF NOT EXISTS materials_name_idx ON materials(name);

CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  car_id        INTEGER NOT NULL REFERENCES cars(id),
  master_id     INTEGER REFERENCES users(id),
  created_by    INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'accepted'
                CHECK (status IN ('draft','accepted','in_work','ready','closed','cancelled')),
  planned_date  TEXT,
  comment       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  ready_at      TEXT,
  closed_at     TEXT
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_master_idx ON orders(master_id);

CREATE TABLE IF NOT EXISTS order_works (
  id        INTEGER PRIMARY KEY,
  order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  work_id   INTEGER REFERENCES works(id),
  name      TEXT NOT NULL,
  qty       REAL NOT NULL DEFAULT 1,
  price     REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS order_works_order_idx ON order_works(order_id);

CREATE TABLE IF NOT EXISTS order_materials (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'г',
  kind        TEXT NOT NULL DEFAULT 'material' CHECK (kind IN ('paint','material')),
  qty         REAL NOT NULL,
  price       REAL NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_materials_order_idx ON order_materials(order_id);

CREATE TABLE IF NOT EXISTS recipes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base        REAL NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'г',
  mixes       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_pairs (
  id         INTEGER PRIMARY KEY,
  code_a     TEXT NOT NULL,
  code_b     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS code_pairs_uniq ON code_pairs (code_a, code_b);
CREATE INDEX IF NOT EXISTS code_pairs_a ON code_pairs (code_a);
CREATE INDEX IF NOT EXISTS code_pairs_b ON code_pairs (code_b);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, code)
);

/* Техническая документация на материалы: ТДС, паспорта, инструкции */
CREATE TABLE IF NOT EXISTS material_docs (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS material_docs_code_idx ON material_docs(code);

/* Нормы списания: на деталь и на машину. owner_id NULL — общая база. */
CREATE TABLE IF NOT EXISTS norm_items (
  id       INTEGER PRIMARY KEY,
  owner_id INTEGER,
  code     TEXT,
  role     TEXT NOT NULL DEFAULT 'material',
  qty      REAL NOT NULL,
  unit     TEXT NOT NULL DEFAULT 'г',
  per      TEXT NOT NULL DEFAULT 'part',
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS norm_items_owner_idx ON norm_items(owner_id);

CREATE TABLE IF NOT EXISTS norms (
  id      INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  code    TEXT NOT NULL,
  qty     REAL NOT NULL,
  unit    TEXT NOT NULL DEFAULT 'г'
);

CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  payload    TEXT
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit(entity, entity_id);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Внутренний чат: общий канал и обсуждение конкретного заказа.
-- Сообщения не удаляются — вся переписка остаётся историей.
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  channel    TEXT NOT NULL DEFAULT 'general',
  user_id    INTEGER REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages(channel, id);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  order_id   INTEGER,
  channel    TEXT,
  file       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_order_idx ON photos(order_id);
CREATE INDEX IF NOT EXISTS photos_channel_idx ON photos(channel);

CREATE TABLE IF NOT EXISTS order_reads (
  user_id  INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  seen_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, order_id)
);

CREATE TABLE IF NOT EXISTS chat_reads (
  user_id  INTEGER NOT NULL,
  channel  TEXT NOT NULL,
  last_id  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel)
);
`);

/* --------------------------------------------------------------------------
   Миграции
   -------------------------------------------------------------------------- */

function addColumn(table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  return true;
}

/*
 * SQLite сравнивает регистр только для латиницы: «Краска» и «краска» для LIKE —
 * разные строки. Поэтому храним отдельное поле в нижнем регистре и ищем по нему.
 * Заодно приравниваем ё к е — люди пишут и так, и так.
 */
function normalizeSearch(...parts) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join(' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

addColumn('materials', 'search', 'TEXT');
addColumn('users', 'search', 'TEXT');
addColumn('cars', 'search', 'TEXT');

// Рабочее место мастеров: общий вход на компьютере + личный ПИН-код у каждого
addColumn('users', 'is_workstation', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'pin_hash', 'TEXT');
addColumn('users', 'pin_updated_at', 'TEXT');

// Мастера бывают двух специальностей: маляр (работает с материалом)
// и кузовщик (пока только назначается на заказ).
addColumn('users', 'specialty', 'TEXT');
addColumn('messages', 'photo_id', 'INTEGER');
addColumn('works', 'parts', 'REAL DEFAULT 1');
addColumn('order_works', 'parts', 'REAL');
addColumn('materials', 'paint_code', 'TEXT');
addColumn('materials', 'aliases', 'TEXT');
addColumn('materials', 'stock', 'REAL');
addColumn('orders', 'inspection', 'TEXT');
addColumn('code_pairs', 'brand_a', "TEXT DEFAULT 'Brulex'");
addColumn('code_pairs', 'brand_b', "TEXT DEFAULT 'Standox'");

// В заказе два исполнителя: маляр и кузовщик
addColumn('orders', 'bodyworker_id', 'INTEGER');

// В сессии рабочего места хранится, чей кабинет сейчас открыт
addColumn('sessions', 'active_user_id', 'INTEGER');
addColumn('sessions', 'last_seen', 'TEXT');

db.exec('CREATE INDEX IF NOT EXISTS materials_search_idx ON materials(search)');
db.exec('CREATE INDEX IF NOT EXISTS cars_search_idx ON cars(search)');

/* --------------------------------------------------------------------------
   Утилиты
   -------------------------------------------------------------------------- */

const nowISO = () => new Date().toISOString();

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** scrypt-хеш пароля в формате "salt:hash" (обе части hex). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), salt, expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Чтение переменной из старого файла-скрипта (database.js и подобных). */
function loadScriptVar(file, varName) {
  const full = path.join(__dirname, '..', file);
  if (!fs.existsSync(full)) return undefined;

  const src = fs.readFileSync(full, 'utf8') + `\n;__result = typeof ${varName} !== 'undefined' ? ${varName} : undefined;`;
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { timeout: 5000 });
  return ctx.__result;
}

/* --------------------------------------------------------------------------
   Первичное наполнение
   -------------------------------------------------------------------------- */

const DEFAULT_WORKS = [
  ['Покраска бампера', 'Покраска'],
  ['Покраска крыла переднего', 'Покраска'],
  ['Покраска крыла заднего', 'Покраска'],
  ['Покраска двери', 'Покраска'],
  ['Покраска капота', 'Покраска'],
  ['Покраска крышки багажника', 'Покраска'],
  ['Покраска крыши', 'Покраска'],
  ['Покраска порога', 'Покраска'],
  ['Покраска стойки', 'Покраска'],
  ['Покраска зеркала', 'Покраска'],
  ['Покраска молдинга', 'Покраска'],
  ['Покраска проёма', 'Покраска'],
  ['Покраска кузова полностью', 'Покраска'],
  ['Ремонт бампера (пластик)', 'Ремонт'],
  ['Ремонт вмятины', 'Ремонт'],
  ['Шпатлёвка и подготовка детали', 'Подготовка'],
  ['Грунтование детали', 'Подготовка'],
  ['Полировка детали', 'Полировка'],
  ['Полировка кузова', 'Полировка'],
  ['Снятие / установка детали', 'Разборка']
];

function seedWorks() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM works').get().n;
  if (count > 0) return 0;

  const insert = db.prepare('INSERT INTO works (name, category, price, unit, active) VALUES (?, ?, 0, ?, 1)');
  for (const [name, category] of DEFAULT_WORKS) insert.run(name, category, 'шт');
  return DEFAULT_WORKS.length;
}

function seedMaterials() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM materials').get().n;
  if (count > 0) return 0;

  const list = loadScriptVar('database.js', 'database');
  const categories = loadScriptVar('categories.js', 'ITEM_CATEGORY') || {};
  if (!Array.isArray(list) || !list.length) return 0;

  const insert = db.prepare(
    'INSERT INTO materials (code, name, unit, category, price, active, synced_at, search) VALUES (?, ?, ?, ?, 0, 1, ?, ?)'
  );

  let added = 0;
  db.exec('BEGIN');
  try {
    for (const item of list) {
      if (!item || !item.code || !item.name) continue;
      insert.run(String(item.code), String(item.name), 'шт', categories[item.code] || 'other', nowISO(),
        normalizeSearch(item.code, item.name));
      added++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return added;
}

function seedRecipes() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM recipes').get().n;
  if (count > 0) return 0;

  const seed = loadScriptVar('recipes.js', 'RECIPES_SEED');
  if (!Array.isArray(seed) || !seed.length) return 0;

  const insert = db.prepare('INSERT INTO recipes (id, name, base, unit, mixes, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  let added = 0;
  for (const r of seed) {
    if (!r || !r.name || !Array.isArray(r.mixes)) continue;
    insert.run(String(r.id || crypto.randomUUID()), String(r.name), Number(r.base) || 100, r.unit || 'г',
      JSON.stringify(r.mixes), nowISO());
    added++;
  }
  return added;
}

/** Первый администратор. Пароль можно задать переменной окружения. */
function seedAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return null;

  const login = process.env.PAINT_ADMIN_LOGIN || 'admin';
  const password = process.env.PAINT_ADMIN_PASSWORD || 'admin12345';

  db.prepare(
    'INSERT INTO users (login, pass_hash, full_name, role, active, created_at, search) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).run(login, hashPassword(password), 'Администратор', 'admin', nowISO(), normalizeSearch('Администратор'));

  return { login, password };
}

/* --------------------------------------------------------------------------
   Дозаполнение поисковых полей для баз, созданных до их появления
   -------------------------------------------------------------------------- */

function backfillSearch() {
  let touched = 0;

  const updMaterial = db.prepare('UPDATE materials SET search = ? WHERE code = ?');
  for (const row of db.prepare("SELECT code, name FROM materials WHERE search IS NULL OR search = ''").all()) {
    updMaterial.run(normalizeSearch(row.code, row.name), row.code);
    touched++;
  }

  const updUser = db.prepare('UPDATE users SET search = ? WHERE id = ?');
  for (const row of db.prepare("SELECT id, full_name FROM users WHERE search IS NULL OR search = ''").all()) {
    updUser.run(normalizeSearch(row.full_name), row.id);
    touched++;
  }

  const updCar = db.prepare('UPDATE cars SET search = ? WHERE id = ?');
  for (const row of db.prepare("SELECT id, plate, vin, make, model FROM cars WHERE search IS NULL OR search = ''").all()) {
    updCar.run(normalizeSearch(row.plate, row.vin, row.make, row.model), row.id);
    touched++;
  }

  return touched;
}

/* --------------------------------------------------------------------------
   Нумерация заказов: 2026-0001, счётчик отдельный на каждый год
   -------------------------------------------------------------------------- */

function nextOrderNumber() {
  const year = new Date().getFullYear();
  const name = `orders_${year}`;

  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
    const next = (row ? row.value : 0) + 1;
    db.prepare('INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value')
      .run(name, next);
    db.exec('COMMIT');
    return `${year}-${String(next).padStart(4, '0')}`;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/* --------------------------------------------------------------------------
   Журнал изменений
   -------------------------------------------------------------------------- */

function audit(userId, action, entity, entityId, payload) {
  db.prepare('INSERT INTO audit (at, user_id, action, entity, entity_id, payload) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nowISO(), userId ?? null, action, entity, entityId == null ? null : String(entityId),
      payload == null ? null : JSON.stringify(payload));
}

/* --------------------------------------------------------------------------
   Инициализация
   -------------------------------------------------------------------------- */

function init() {
  backfillSearch();

  // До появления кузовщиков все мастера были малярами
  db.prepare(`
    UPDATE users SET specialty = 'painter'
     WHERE role = 'master' AND is_workstation = 0 AND (specialty IS NULL OR specialty = '')
  `).run();

  // Кто ещё ни разу не открывал заказы — тому прошлое не показываем как «изменения».
  // Один раз это делаем для всех: иначе после обновления все старые заказы «горят».
  const now = new Date().toISOString();
  const markSeen = db.prepare(`
    INSERT OR IGNORE INTO order_reads (user_id, order_id, seen_at)
    SELECT ?, id, ? FROM orders
  `);

  const done = db.prepare("SELECT value FROM settings WHERE key = 'order_reads_ready'").get();

  if (!done) {
    db.prepare(`
      INSERT OR IGNORE INTO order_reads (user_id, order_id, seen_at)
      SELECT u.id, o.id, ? FROM users u CROSS JOIN orders o
    `).run(now);

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('order_reads_ready', '1')").run();
  }

  const freshUsers = db.prepare(`
    SELECT u.id FROM users u
     WHERE NOT EXISTS (SELECT 1 FROM order_reads r WHERE r.user_id = u.id)
  `).all();

  for (const user of freshUsers) markSeen.run(user.id, now);

  // Код цвета берём из названия краски: «563 Schwarz B 3.5 ltr» → 563
  // Код берём из названия: «563 Schwarz B 3.5 ltr» и «Краска Brulex MIX 110B» — оба про 3 цифры

  // Таблица соответствий Brutex ↔ Standox (солидные компоненты)
  const pairsReady = db.prepare("SELECT value FROM settings WHERE key = 'code_pairs_ready'").get();

  if (!pairsReady) {
    const solidPairs = [
      ['101', '562'], ['102', '561'], ['103', '563'], ['104', '566'], ['105', '567'],
      ['106', '814'], ['107', '886'], ['109', '569'], ['110', '570'], ['111', '571'],
      ['112', '573'], ['114', '574'], ['115', '576'], ['116', '575'], ['119', '577'],
      ['121', '588'], ['123', '589'], ['124', '579'], ['127', '583'], ['128', '816'],
      ['129', '586'], ['142', '587'], ['144', '849'], ['148', '585'], ['151', '810'],
      ['153', '859'], ['154', '851'], ['155', '854'], ['157', '856'], ['160', '855'],
      ['162', '857'], ['164', '861'], ['168', '870'], ['170', '882'], ['172', '884'],
      ['173', '885'], ['177', '008'], ['178', '883'], ['181', '581'], ['182', '580'],
      ['183', '582'], ['184', '564'], ['189', '815'], ['196', '896'], ['197', '897'],
      ['199', '599'],
      // металлики
      ['130', '593'], ['131', '811'], ['132', '812'], ['133', '590'], ['135', '595'],
      ['136', '813'], ['137', '594'], ['138', '598'], ['149', '806'], ['180', '818'],
      ['185', '895'], ['186', '892'], ['187', '891'], ['190', '819'], ['143', '887'],
      ['193', '893'],
      // перламутры
      ['201', '801'], ['202', '802'], ['203', '803'], ['205', '805'], ['206', '804'],
      ['207', '829'], ['208', '825'], ['209', '821'], ['210', '827'], ['211', '839'],
      ['212', '846'], ['213', '843'], ['214', '845'], ['215', '823'], ['216', '826'],
      ['217', '824'], ['218', '836'], ['220', '844'], ['221', '828'], ['222', '894'],
      ['223', '820'], ['224', '831'], ['225', '841'], ['228', '888'], ['235', 'PP304']
    ];

    const insertPair = db.prepare('INSERT OR IGNORE INTO code_pairs (code_a, code_b, created_at) VALUES (?, ?, ?)');
    const moment = new Date().toISOString();

    for (const [brutex, standox] of solidPairs) insertPair.run(brutex, standox, moment);

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('code_pairs_ready', '1')").run();
  }

  const paintsWithoutCode = db.prepare(`
    SELECT code, name FROM materials
     WHERE category = 'paint' AND (paint_code IS NULL OR paint_code = '')
  `).all();

  const setPaintCode = db.prepare('UPDATE materials SET paint_code = ? WHERE code = ?');

  for (const paint of paintsWithoutCode) {
    const match = /(?:^|\s)(\d{3})(?=[A-Za-zА-Яа-я]|\s|$)/.exec(paint.name);
    if (match) setPaintCode.run(match[1], paint.code);
  }

  // Остатки со склада: разово переносим из отчёта (server/data-stock.json)
  const stockApplied = db.prepare("SELECT value FROM settings WHERE key = 'stock-from-report'").get();

  if (!stockApplied) {
    const stockFile = path.join(__dirname, 'data-stock.json');

    if (fs.existsSync(stockFile)) {
      const stockRows = JSON.parse(fs.readFileSync(stockFile, 'utf8'));
      const setStock = db.prepare('UPDATE materials SET stock = ?, unit = ? WHERE code = ?');

      let applied = 0;
      for (const row of stockRows) {
        const info = setStock.run(Number(row.stock) || 0, row.unit || 'шт', row.code);
        if (info.changes > 0) applied++;
      }

      console.log('остатки со склада применены:', applied);
    }

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('stock-from-report', '1')").run();
  }

  /* Нормы списания по умолчанию: на деталь и на машину (общая база для всех) */
  const normSeed = db.prepare("SELECT value FROM settings WHERE key = 'norm-set-seeded'").get();

  if (!normSeed) {
    const commonCount = db.prepare('SELECT COUNT(*) AS n FROM norm_items WHERE owner_id IS NULL').get().n;

    if (!commonCount) {
      const insertNorm = db.prepare(`INSERT INTO norm_items (owner_id, code, role, qty, unit, per, sort)
                                     VALUES (NULL, ?, ?, ?, ?, ?, ?)`);

      const defaults = [
        ['', 'paint', 300, 'г', 'part'],            // краска — выбирается в наряде
        ['SE343475', 'material', 300, 'г', 'part'], // лак Normex 2K VHS-455
        ['SE339776', 'material', 150, 'г', 'part'], // отвердитель Normex 2K 822
        ['SE300301', 'material', 150, 'г', 'part'], // разбавитель Brulex
        ['SE313518', 'material', 1, 'шт', 'order'], // салфетка липкая — на машину
        ['SE018866', 'material', 1, 'шт', 'order']  // растворитель 650 — на машину
      ];

      defaults.forEach((row, index) => insertNorm.run(row[0], row[1], row[2], row[3], row[4], index));

      console.log('нормы списания: загружены значения по умолчанию');
    }

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('norm-set-seeded', '1')").run();
  }

  // Работы измеряются в деталях: капот — 1, большой капот — 1,5.
  // Детали имеют смысл только у покраски — остальным работам их не ставим.
  const paintWorks = db.prepare('SELECT id, name, category FROM works').all();
  const clearParts = db.prepare('UPDATE works SET parts = NULL WHERE id = ?');

  for (const work of paintWorks) {
    const isPaint = /покраск/i.test(work.category || '') || /^\s*покраск/i.test(work.name || '');
    if (!isPaint) clearParts.run(work.id);
    else if (!work.parts) db.prepare('UPDATE works SET parts = 1 WHERE id = ?').run(work.id);
  }

  const works = seedWorks();
  const materials = seedMaterials();
  const recipes = seedRecipes();
  const admin = seedAdmin();

  return { works, materials, recipes, admin };
}


/**
 * Переносит соответствия кодов в карточки красок: у материала появляется
 * второе название («Brulex 132»), и поиск находит его обычным способом.
 */
function rebuildPaintAliases() {
  const pairs = db.prepare('SELECT code_a, code_b, brand_a, brand_b FROM code_pairs').all();
  const aliases = new Map();

  for (const pair of pairs) {
    const brandA = pair.brand_a || 'Brulex';
    const brandB = pair.brand_b || 'Standox';

    if (!aliases.has(pair.code_a)) aliases.set(pair.code_a, new Set());
    if (!aliases.has(pair.code_b)) aliases.set(pair.code_b, new Set());

    aliases.get(pair.code_a).add(brandB + ' ' + pair.code_b);
    aliases.get(pair.code_b).add(brandA + ' ' + pair.code_a);
  }

  const paints = db.prepare("SELECT code, name, paint_code FROM materials WHERE category = 'paint'").all();
  const update = db.prepare('UPDATE materials SET aliases = ?, search = ? WHERE code = ?');

  for (const paint of paints) {
    const list = paint.paint_code && aliases.has(paint.paint_code)
      ? [...aliases.get(paint.paint_code)].join(', ')
      : '';

    update.run(list || null, normalizeSearch(paint.code, paint.name, list), paint.code);
  }
}

module.exports = {
  db,
  rebuildPaintAliases,
  DB_PATH,
  DATA_DIR,
  init,
  nowISO,
  normalizeSearch,
  randomToken,
  hashPassword,
  verifyPassword,
  nextOrderNumber,
  audit
};
