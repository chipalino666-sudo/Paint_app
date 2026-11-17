'use strict';

/*
 * Приводит номера демонстрационных заказов к виду 2026-0001… по порядку создания
 * и сбрасывает счётчик, чтобы следующий заказ был 2026-0007.
 */

const { db } = require('/opt/paint/server/db.js');

const orders = db.prepare('SELECT id, number FROM orders ORDER BY id').all();

if (!orders.length) {
  console.log('заказов нет');
  process.exit(0);
}

db.exec('BEGIN');

// Сначала временные номера, чтобы не столкнуться с UNIQUE
for (const order of orders) {
  db.prepare('UPDATE orders SET number = ? WHERE id = ?').run(`tmp-${order.id}`, order.id);
}

orders.forEach((order, index) => {
  db.prepare('UPDATE orders SET number = ? WHERE id = ?').run(`2026-${String(index + 1).padStart(4, '0')}`, order.id);
});

db.prepare("DELETE FROM counters WHERE name = 'order'").run();
db.exec('COMMIT');

console.log('перенумеровано:', db.prepare('SELECT number FROM orders ORDER BY id').all().map((o) => o.number).join(', '));
