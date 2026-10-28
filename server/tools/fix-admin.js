'use strict';

// Разовая починка: вернуть логину admin роль администратора.
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('data/paint.db');
const result = db.prepare("UPDATE users SET role = 'admin' WHERE login = 'admin'").run();

console.log('строк обновлено:', result.changes);
console.log(db.prepare('SELECT login, role, full_name FROM users ORDER BY id').all()
  .map((row) => `${row.login}:${row.role}`).join(', '));

db.close();
