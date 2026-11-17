'use strict';

/*
 * Ищет в старой базе «сдвиг» названий: когда название кода X совпадает
 * с названием соседнего кода из новой распознанной базы.
 *
 *   node tools/check-shift.js
 */

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'Photo', 'parsed');
const merged = JSON.parse(fs.readFileSync(path.join(dir, 'merged.json'), 'utf8'));
const old = JSON.parse(fs.readFileSync(path.join(dir, 'old-base.json'), 'utf8').replace(/^\uFEFF/, ''));

const oldByCode = new Map(old.map((item) => [item.code, item.name]));
const newItems = merged.merged;

// Порядок кодов в новой базе (как на фото)
const order = newItems.map((item) => item.code);
const indexOf = new Map(order.map((code, i) => [code, i]));

const shifts = [];

for (const item of newItems) {
  const oldName = oldByCode.get(item.code);
  if (!oldName || oldName === item.name) continue;

  // Совпадает ли старое название с названием соседа (в пределах трёх позиций)
  const i = indexOf.get(item.code);

  for (const delta of [-2, -1, 1, 2]) {
    const neighbor = newItems[i + delta];
    if (!neighbor) continue;

    if (neighbor.name === oldName) {
      shifts.push({
        code: item.code,
        сосед: neighbor.code,
        смещение: delta,
        старое_название: oldName,
        новое_название: item.name
      });
      break;
    }
  }
}

console.log('ПОДОЗРЕНИЕ НА СДВИГ:', shifts.length);
shifts.slice(0, 25).forEach((s) => {
  console.log(`  ${s.code} (сдвиг ${s.смещение} к ${s.сосед})`);
  console.log(`     старое: ${s.старое_название}`);
  console.log(`     новое:  ${s.новое_название}`);
});

fs.writeFileSync(path.join(dir, 'shift-report.json'), JSON.stringify(shifts, null, 2), 'utf8');
