'use strict';

/*
 * Переводит остатки в граммы: краски, лаки, отвердители и разбавители
 * (кроме «Hybrid») в отчёте склада ведутся в килограммах.
 *
 *   node tools/convert-to-grams.js          — показать, что будет изменено
 *   node tools/convert-to-grams.js apply     — применить
 *
 * Скрипт идемпотентен: уже переведённые (единица «г») не трогает.
 */

const path = require('node:path');

const dbFile = process.argv[3] || '/opt/paint/server/data/paint.db';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(dbFile);

const apply = process.argv[2] === 'apply';

const isHybrid = (name) => /hybrid|hybryd/i.test(name);

const all = db.prepare('SELECT code, name, unit, stock, category FROM materials').all();

const targets = all.filter((m) => {
  const name = String(m.name || '');

  if (isHybrid(name)) return false;
  if (m.category === 'paint') return m.unit !== 'г';
  if (m.category === 'clear' || m.category === 'hardener') return true;
  if (m.category === 'thinner') return /разбавител/i.test(name) && !/растворител/i.test(name);

  return false;
});

console.log('к переводу:', targets.length);

for (const m of targets) {
  const grams = m.stock === null ? null : Math.round(Number(m.stock) * 1000 * 100) / 100;
  console.log(`  ${m.name}: ${m.stock} ${m.unit} → ${grams} г`);
}

if (!apply) {
  console.log('\nчтобы применить — запустите с параметром apply');
  process.exit(0);
}

const update = db.prepare('UPDATE materials SET stock = ?, unit = ? WHERE code = ?');

db.exec('BEGIN');
try {
  for (const m of targets) {
    const grams = m.stock === null ? null : Math.round(Number(m.stock) * 1000 * 100) / 100;
    update.run(grams, 'г', m.code);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log('\nприменено:', targets.length);