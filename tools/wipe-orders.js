'use strict';

/*
 * Очищает демонстрационные заказы, переписку и фотографии.
 * Пользователи и справочники не трогаются.
 *
 *   node /tmp/wipe-orders.js            — показать, что будет удалено
 *   node /tmp/wipe-orders.js yes        — удалить
 */

const { db } = require('/opt/paint/server/db.js');

const confirm = process.argv[2] === 'yes';

const count = (table) => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

console.log('заказов:', count('orders'));
console.log('работ в заказах:', count('order_works'));
console.log('материалов в заказах:', count('order_materials'));
console.log('сообщений:', count('messages'));
console.log('фотографий:', count('photos'));

if (!confirm) {
  console.log('\nчтобы удалить — запустите с параметром yes');
  process.exit(0);
}

db.exec(`
  DELETE FROM order_works;
  DELETE FROM order_materials;
  DELETE FROM order_reads;
  DELETE FROM messages;
  DELETE FROM photos;
  DELETE FROM orders;
  DELETE FROM cars;
`);

db.prepare("DELETE FROM counters WHERE name = 'order'").run();

console.log('\nочищено. заказов теперь:', count('orders'));
