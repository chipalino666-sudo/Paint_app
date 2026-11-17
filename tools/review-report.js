'use strict';

/*
 * Готовит список расхождений для ручной проверки:
 * сдвиги названий, смысловые и косметические отличия, новые и пропавшие позиции.
 *
 *   node tools/review-report.js
 */

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'Photo', 'parsed');
const merged = JSON.parse(fs.readFileSync(path.join(dir, 'merged.json'), 'utf8'));
const old = JSON.parse(fs.readFileSync(path.join(dir, 'old-base.json'), 'utf8').replace(/^\uFEFF/, ''));
const shifts = JSON.parse(fs.readFileSync(path.join(dir, 'shift-report.json'), 'utf8'));

const oldByCode = new Map(old.map((item) => [item.code, item.name]));
const shiftCodes = new Set(shifts.map((s) => s.code));

/** Приводим название к «скелету»: регистр, В/В, запятые, пробелы, кавычки. */
function skeleton(name) {
  return String(name)
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[вb]/g, 'b')
    .replace(/[хx]/g, 'x')
    .replace(/[аa]/g, 'a')
    .replace(/[рp]/g, 'p')
    .replace(/[сc]/g, 'c')
    .replace(/[еe]/g, 'e')
    .replace(/[оo]/g, 'o')
    .replace(/[кk]/g, 'k')
    .replace(/[мm]/g, 'm')
    .replace(/[тt]/g, 't')
    .replace(/[нh]/g, 'h')
    .replace(/[\s,.;:()"'«»+\-–—/\\*!?]+/g, '')
    .trim();
}

const cosmetic = [];
const meaningful = [];

for (const item of merged.merged) {
  const oldName = oldByCode.get(item.code);
  if (!oldName || oldName === item.name) continue;

  const row = { code: item.code, oldName, newName: item.name, qty: item.qty };

  if (shiftCodes.has(item.code)) continue; // сдвиги показываем отдельно

  if (skeleton(oldName) === skeleton(item.name)) cosmetic.push(row);
  else meaningful.push(row);
}

function csvEscape(value) {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}

const lines = [];
lines.push('Раздел;Код;Старое название;Новое название;Остаток');

shifts.forEach((s) => {
  lines.push([
    'СДВИГ НАЗВАНИЙ',
    s.code,
    s.старое_название,
    s.новое_название,
    ''
  ].map(csvEscape).join(';'));
});

meaningful.forEach((r) => {
  lines.push(['РАЗНОЕ НАПИСАНИЕ', r.code, r.oldName, r.newName, r.qty].map(csvEscape).join(';'));
});

cosmetic.forEach((r) => {
  lines.push(['мелочи (запятые, буквы B/В)', r.code, r.oldName, r.newName, r.qty].map(csvEscape).join(';'));
});

merged.added.forEach((r) => {
  lines.push(['НОВАЯ ПОЗИЦИЯ', r.code, '', r.name, r.qty].map(csvEscape).join(';'));
});

merged.gone.forEach((r) => {
  lines.push(['НЕТ НА ФОТО', r.code, r.name, '', ''].map(csvEscape).join(';'));
});

const out = path.join(dir, 'сверка.csv');
fs.writeFileSync(out, '\uFEFF' + lines.join('\r\n'), 'utf8');

console.log('сдвиги:', shifts.length);
console.log('смысловые отличия:', meaningful.length);
console.log('косметические:', cosmetic.length);
console.log('новые:', merged.added.length, '| пропавшие:', merged.gone.length);
console.log('\n--- СМЫСЛОВЫЕ ОТЛИЧИЯ ---');
meaningful.slice(0, 20).forEach((r) => {
  console.log(`${r.code}`);
  console.log(`   старое: ${r.oldName}`);
  console.log(`   новое:  ${r.newName}`);
});
console.log('\nфайл: Photo/parsed/сверка.csv');
