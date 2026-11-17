'use strict';

/*
 * Исправляет список избранного:
 *   1) при переходе во вкладку «Избранное» сбрасывается строка поиска,
 *      иначе показывались только совпадения по старому запросу;
 *   2) для избранного снято ограничение в 30 строк.
 *
 *   node tools/fix-favorites.js <папка PaintApp_mini>
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const appFile = path.join(root, 'app.js');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

// 1. Ограничение по количеству строк
const oldLimit = `  function appendItemList(container, items, emptyText) {
    const limited = items.slice(0, MAX_RESULTS);`;

const newLimit = `  function appendItemList(container, items, emptyText) {
    // В избранном показываем всё, что человек отметил, без ограничения
    const limit = activeCategory === 'favorites' ? 500 : MAX_RESULTS;
    const limited = items.slice(0, limit);`;

if (!app.includes(oldLimit)) {
  console.error('Не нашёл appendItemList');
  process.exit(1);
}

app = app.replace(oldLimit, newLimit);

// 2. Сброс поиска при переходе в избранное
const oldChip = `    fav.addEventListener('click', () => {
      activeCategory = 'favorites';
      renderChips();
      renderSearchView();
    });`;

const newChip = `    fav.addEventListener('click', () => {
      activeCategory = 'favorites';

      // Иначе в избранном останутся только совпадения по прошлому запросу
      $('#search').value = '';

      renderChips();
      renderSearchView();
    });`;

if (!app.includes(oldChip)) {
  console.error('Не нашёл обработчик вкладки');
  process.exit(1);
}

app = app.replace(oldChip, newChip);

fs.writeFileSync(appFile, app);
console.log('избранное исправлено');
