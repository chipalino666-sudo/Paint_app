'use strict';

/*
 * Заменяет демонстрационных сотрудников на реальные имена цеха:
 *   маляры: Фетисов, Пройсковский, Бочкарёв, Ананьев
 *   кузовщик: Панфилов
 *   остальные — по должностям, без имён
 *
 * Запуск на сервере от root:  node /tmp/staff.js
 */

const { db, nowISO, hashPassword, normalizeSearch } = require('/opt/paint/server/db.js');

const PASSWORD = 'demo12345';

const staff = [
  { login: 'fetisov', full_name: 'Фетисов Максим', role: 'master', specialty: 'painter', pin: '1111' },
  { login: 'proyskovsky', full_name: 'Пройсковский Альберт', role: 'master', specialty: 'painter', pin: '2222' },
  { login: 'bochkarev', full_name: 'Бочкарёв Николай', role: 'master', specialty: 'painter', pin: '3333' },
  { login: 'ananyev', full_name: 'Ананьев Алексей', role: 'master', specialty: 'painter', pin: '4444' },
  { login: 'panfilov', full_name: 'Панфилов Алексей', role: 'master', specialty: 'bodyworker', pin: null },
  { login: 'manager', full_name: 'Приёмщик', role: 'manager', specialty: null, pin: null },
  { login: 'store', full_name: 'Склад', role: 'store', specialty: null, pin: null }
];

const insert = db.prepare(`
  INSERT INTO users (login, pass_hash, full_name, role, active, created_at, search, is_workstation, specialty, pin_hash)
  VALUES (?, ?, ?, ?, 1, ?, ?, 0, ?, ?)
`);

const update = db.prepare(`
  UPDATE users SET full_name = ?, role = ?, specialty = ?, pin_hash = ?, search = ?, active = 1 WHERE id = ?
`);

for (const person of staff) {
  const pinHash = person.pin ? hashPassword(person.pin) : null;
  const existing = db.prepare('SELECT id FROM users WHERE login = ?').get(person.login);

  if (existing) {
    update.run(person.full_name, person.role, person.specialty, pinHash, normalizeSearch(person.full_name), existing.id);
    console.log('обновлён:', person.full_name);
  } else {
    insert.run(person.login, hashPassword(PASSWORD), person.full_name, person.role,
      nowISO(), normalizeSearch(person.full_name), person.specialty, pinHash);
    console.log('создан:', person.full_name);
  }
}

const idOf = (login) => {
  const row = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
  return row ? row.id : null;
};

// Куда перевести заказы и сообщения от старых демо-сотрудников
const map = {
  ivanov: idOf('fetisov'),
  sergeev: idOf('proyskovsky'),
  kuznetsov: idOf('bochkarev'),
  body1: idOf('panfilov'),
  manager1: idOf('manager'),
  store1: idOf('store')
};

for (const [oldLogin, newId] of Object.entries(map)) {
  const oldId = idOf(oldLogin);
  if (!oldId || !newId) continue;

  db.prepare('UPDATE orders SET master_id = ? WHERE master_id = ?').run(newId, oldId);
  db.prepare('UPDATE orders SET bodyworker_id = ? WHERE bodyworker_id = ?').run(newId, oldId);
  db.prepare('UPDATE orders SET created_by = ? WHERE created_by = ?').run(newId, oldId);
  db.prepare('UPDATE messages SET user_id = ? WHERE user_id = ?').run(newId, oldId);
  db.prepare('UPDATE audit SET user_id = ? WHERE user_id = ?').run(newId, oldId);
  db.prepare('UPDATE photos SET user_id = ? WHERE user_id = ?').run(newId, oldId);
  db.prepare('UPDATE order_materials SET created_by = ? WHERE created_by = ?').run(newId, oldId);
}

for (const oldLogin of Object.keys(map)) {
  db.prepare('DELETE FROM users WHERE login = ?').run(oldLogin);
}

// Распределяем заказы между малярами
const assignments = [
  ['fetisov', null],
  ['proyskovsky', null],
  ['bochkarev', 'panfilov'],
  ['ananyev', null],
  ['fetisov', null],
  ['proyskovsky', null]
];

const orders = db.prepare('SELECT id FROM orders ORDER BY id').all();

orders.forEach((order, index) => {
  const [master, bodyworker] = assignments[index] || [];
  db.prepare('UPDATE orders SET master_id = ?, bodyworker_id = ? WHERE id = ?')
    .run(idOf(master), bodyworker ? idOf(bodyworker) : null, order.id);
});

console.log('\nсотрудники:');
db.prepare('SELECT login, full_name, role, specialty, is_workstation FROM users ORDER BY id').all().forEach((u) => {
  console.log(`  ${u.login} — ${u.full_name} — ${u.role}${u.specialty ? '/' + u.specialty : ''}`);
});

console.log('\nзаказы:');
db.prepare(`SELECT o.number, m.full_name AS master, b.full_name AS bodyworker
              FROM orders o
              LEFT JOIN users m ON m.id = o.master_id
              LEFT JOIN users b ON b.id = o.bodyworker_id
             ORDER BY o.id`).all().forEach((o) => {
  console.log(`  ${o.number} — ${o.master || '—'}${o.bodyworker ? ', кузовщик ' + o.bodyworker : ''}`);
});
