'use strict';

/*
 * Создаёт (или удаляет) временного администратора для наполнения сайта демо-данными.
 * Запускается на сервере от root:
 *
 *   node /tmp/seedbot.js create
 *   node /tmp/seedbot.js delete
 */

const { db, nowISO, hashPassword, normalizeSearch } = require('/opt/paint/server/db.js');

const action = process.argv[2] || 'create';
const login = 'seedbot';

if (action === 'delete') {
  db.prepare('DELETE FROM users WHERE login = ?').run(login);
  console.log('временный пользователь удалён');
  process.exit(0);
}

const exists = db.prepare('SELECT id FROM users WHERE login = ?').get(login);

if (exists) {
  db.prepare('UPDATE users SET pass_hash = ?, active = 1 WHERE id = ?')
    .run(hashPassword('SeedDemo2026!'), exists.id);
  console.log('временный пользователь обновлён');
} else {
  db.prepare(`INSERT INTO users (login, pass_hash, full_name, role, active, created_at, search, is_workstation, specialty)
              VALUES (?, ?, ?, 'admin', 1, ?, ?, 0, NULL)`)
    .run(login, hashPassword('SeedDemo2026!'), 'Наполнение демо', nowISO(), normalizeSearch('Наполнение демо'));
  console.log('временный пользователь создан');
}
