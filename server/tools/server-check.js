'use strict';

/* Разовая проверка базы на сервере: отметки просмотра заказов. */

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(process.argv[2] || '/opt/paint/server/data', 'paint.db'));

const rows = db.prepare('SELECT COUNT(*) AS n FROM order_reads').get().n;
const flag = db.prepare("SELECT value FROM settings WHERE key = 'order_reads_ready'").get();
const users = db.prepare(`
  SELECT COUNT(*) AS n FROM users u
   WHERE NOT EXISTS (SELECT 1 FROM order_reads r WHERE r.user_id = u.id)
`).get().n;

console.log('строк в order_reads:', rows);
console.log('отметка миграции:', flag ? flag.value : 'нет');
console.log('пользователей без отметок:', users);
