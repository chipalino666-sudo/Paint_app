'use strict';

/*
 * Сводит распознанные строки из Photo/parsed/*.txt, убирает дубли по коду
 * и сравнивает с прошлой базой (473 позиции).
 *
 *   node tools/merge-photos.js
 */

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'Photo', 'parsed');
const files = fs.readdirSync(dir).filter((f) => f.startsWith('ocr-') && f.endsWith('.txt'));

const rows = [];
const sources = {};

for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');

  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('|')) continue;

    const [code, name, qty] = line.split('|').map((part) => part.trim());
    if (!/^[A-Z]{2}\d{4,}$/.test(code || '')) continue;
    if (!name) continue;

    rows.push({ code, name, qty, file });
    sources[code] = sources[code] || new Set();
    sources[code].add(file);
  }
}

// Свернём по коду: если остаток расходится — отметим конфликт
const byCode = new Map();

for (const row of rows) {
  const existing = byCode.get(row.code);

  if (!existing) {
    byCode.set(row.code, { ...row, duplicates: 1, conflict: false, values: new Set([row.qty]) });
    continue;
  }

  existing.duplicates += 1;
  existing.values.add(row.qty);
  if (existing.values.size > 1) existing.conflict = true;
  if (row.name.length > existing.name.length) existing.name = row.name;
}

const merged = [...byCode.values()];
const conflicts = merged.filter((r) => r.conflict);
const multiPage = merged.filter((r) => r.duplicates > 1);

// Сравнение со старой базой
const old = JSON.parse(
  fs.readFileSync(path.join(dir, 'old-base.json'), 'utf8').replace(/^\uFEFF/, '')
);
const oldByCode = new Map(old.map((item) => [item.code, item.name]));

const added = merged.filter((r) => !oldByCode.has(r.code));
const gone = old.filter((item) => !byCode.has(item.code));
const renamed = merged.filter((r) => oldByCode.has(r.code) && oldByCode.get(r.code) !== r.name);

const report = {
  строк_всего: rows.length,
  уникальных_кодов: merged.length,
  повторов_по_коду: multiPage.length,
  конфликтов_остатка: conflicts.length,
  новых_позиций: added.length,
  пропавших_из_старой_базы: gone.length,
  с_другим_названием: renamed.length
};

console.log(JSON.stringify(report, null, 2));

fs.writeFileSync(path.join(dir, 'merged.json'), JSON.stringify({
  report,
  merged,
  conflicts: conflicts.map((r) => ({ code: r.code, name: r.name, values: [...r.values] })),
  added: added.map((r) => ({ code: r.code, name: r.name, qty: r.qty })),
  gone: gone.map((r) => ({ code: r.code, name: r.name })),
  renamed: renamed.map((r) => ({
    code: r.code,
    было: oldByCode.get(r.code),
    стало: r.name
  }))
}, null, 2), 'utf8');

console.log('\nфайл: Photo/parsed/merged.json');
