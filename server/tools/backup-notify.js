'use strict';

/*
 * Сообщение в обсуждения цеха от имени администратора.
 * Нужно, чтобы бэкап сам предупредил людей, если не смог сделаться.
 *
 *   node tools/backup-notify.js "текст сообщения"
 */

const { db, nowISO } = require('../db.js');

const arg = process.argv[2] || '';

// Текст можно присылать в base64 — так он не ломается на пробелах и кавычках
const text = arg === '--b64'
  ? Buffer.from(String(process.argv[3] || ''), 'base64').toString('utf8').trim()
  : String(arg).trim();

if (!text) {
  console.error(JSON.stringify({ ok: false, error: 'нет текста' }));
  process.exit(1);
}

const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
const body = text.slice(0, 2000);

db.prepare("INSERT INTO messages (channel, user_id, body, created_at) VALUES ('general', ?, ?, ?)")
  .run(admin ? admin.id : null, body, nowISO());

console.log(JSON.stringify({ ok: true }));
