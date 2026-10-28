'use strict';

/*
 * Проверяет, какие события заказа считаются «важными» для уведомлений.
 *   node tools/check-unread.js [orderId]
 */

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, '..', 'data', 'paint.db');
const db = new DatabaseSync(dbPath);

const orderId = Number(process.argv[2] || 8);

const actions = db.prepare(`
  SELECT action, COUNT(*) AS n
    FROM audit
   WHERE entity = 'order' AND entity_id = ?
   GROUP BY action
   ORDER BY action
`).all(String(orderId));

console.log(`События заказа ${orderId}:`);
for (const row of actions) {
  const important = ['create', 'change', 'work_add', 'work_edit', 'work_remove'].includes(row.action);
  console.log(`  ${row.action.padEnd(16)} ${String(row.n).padStart(3)}  ${important ? 'уведомлять' : 'не уведомлять'}`);
}

const admin = db.prepare("SELECT id FROM users WHERE login = 'admin'").get();
const seen = db.prepare('SELECT seen_at FROM order_reads WHERE user_id = ? AND order_id = ?')
  .get(admin.id, orderId);

console.log('\nОтметка просмотра админом:', seen ? seen.seen_at : 'не открывал');

const unread = db.prepare(`
  SELECT COUNT(*) AS n
    FROM audit a
   WHERE a.entity = 'order' AND a.entity_id = ?
     AND a.user_id <> ?
     AND a.action IN ('create', 'change', 'work_add', 'work_edit', 'work_remove')
     AND a.at > COALESCE(?, '')
`).get(String(orderId), admin.id, seen ? seen.seen_at : '');

const withMaterials = db.prepare(`
  SELECT COUNT(*) AS n
    FROM audit a
   WHERE a.entity = 'order' AND a.entity_id = ?
     AND a.user_id <> ?
     AND a.action IN ('create', 'change', 'work_add', 'work_edit', 'work_remove',
                      'material_add', 'material_edit', 'material_remove')
     AND a.at > COALESCE(?, '')
`).get(String(orderId), admin.id, seen ? seen.seen_at : '');

console.log(`\nНепрочитанных изменений (как считает сайт): ${unread.n}`);
console.log(`Если бы считали и материалы:                ${withMaterials.n}`);
