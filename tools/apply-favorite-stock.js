'use strict';

/*
 * Добавляет в бланковую программу:
 *   1) избранное — звёздочка у материала и вкладка-фильтр «★ Избранное»;
 *   2) постоянный остаток — списанное вычитается при закрытии наряда
 *      и сохраняется в браузере; есть сброс к числам из отчёта.
 *
 *   node tools/apply-favorite-stock.js <папка PaintApp_mini>
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const appFile = path.join(root, 'app.js');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

if (app.includes('LS_FAVORITES')) {
  console.log('уже подключено');
  process.exit(0);
}

/* 1. Ключи хранилища */
app = app.replace(
  "  const LS_EXPORTED = 'paintShopLastExport';",
  `  const LS_EXPORTED = 'paintShopLastExport';
  const LS_FAVORITES = 'paintShopFavorites';
  const LS_STOCK = 'paintShopStock';`
);

/* 2. Постоянный остаток и избранное */
const stockAnchor = `  function stockInfo(code) {
    const item = database.find((i) => i.code === code);
    if (!item || typeof item.stock !== 'number') return null;

    return { base: item.stock, unit: item.unit || '' };
  }`;

const stockNew = `  /* Остаток хранится между сеансами: списали — вычлось навсегда */
  let savedStock = null;

  function loadStock() {
    if (savedStock) return savedStock;

    const stored = store.get(LS_STOCK, null);
    savedStock = stored && typeof stored === 'object' ? stored : {};

    return savedStock;
  }

  function persistStock() {
    store.set(LS_STOCK, loadStock());
  }

  function resetStock() {
    savedStock = {};
    store.set(LS_STOCK, {});
  }

  function stockInfo(code) {
    const item = database.find((i) => i.code === code);
    if (!item || typeof item.stock !== 'number') return null;

    const stock = loadStock();
    const base = typeof stock[code] === 'number' ? stock[code] : item.stock;

    return { base, unit: item.unit || '' };
  }

  /* Избранное */
  function favorites() {
    const list = store.get(LS_FAVORITES, []);
    return Array.isArray(list) ? list : [];
  }

  function isFavorite(code) {
    return favorites().includes(code);
  }

  function toggleFavorite(code) {
    const list = favorites();
    const next = list.includes(code) ? list.filter((c) => c !== code) : [...list, code];

    store.set(LS_FAVORITES, next);
    renderSearchView();
  }`;

if (!app.includes(stockAnchor)) {
  console.error('Не нашёл stockInfo');
  process.exit(1);
}

app = app.replace(stockAnchor, stockNew);

/* 3. Списание закрепляем при закрытии наряда */
const clearOld = `  function clearAll() {
    if (!confirm('Начать новый заказ-наряд? Данные сотрутся.')) return;

    ['orderNum', 'carModel', 'vin', 'master'].forEach((id) => { $('#' + id).value = ''; });`;

const clearNew = `  function clearAll() {
    if (!confirm('Начать новый заказ-наряд? Данные сотрутся, а списанное уйдёт из остатков.')) return;

    // Списанное вычитаем из остатков навсегда
    const stock = loadStock();

    document.querySelectorAll('#table-paint tbody tr, #table-materials tbody tr').forEach((row) => {
      const input = row.querySelector('input');
      const qty = parseFloat(input && input.value ? input.value : 0) || 0;
      if (!qty) return;

      const code = row.dataset.code;
      const item = database.find((i) => i.code === code);
      if (!item || typeof item.stock !== 'number') return;

      const before = typeof stock[code] === 'number' ? stock[code] : item.stock;
      stock[code] = Math.max(0, round2(before - qty));
    });

    persistStock();

    ['orderNum', 'carModel', 'vin', 'master'].forEach((id) => { $('#' + id).value = ''; });`;

if (!app.includes(clearOld)) {
  console.error('Не нашёл clearAll');
  process.exit(1);
}

app = app.replace(clearOld, clearNew);

/* 4. Фильтр избранного */
const filterOld = `      if (activeCategory !== 'all' && categoryOf(item.code) !== activeCategory) return false;`;

const filterNew = `      if (activeCategory === 'favorites') {
        if (!isFavorite(item.code)) return false;
      } else if (activeCategory !== 'all' && categoryOf(item.code) !== activeCategory) {
        return false;
      }`;

if (!app.includes(filterOld)) {
  console.error('Не нашёл фильтр категорий');
  process.exit(1);
}

app = app.replace(filterOld, filterNew);

/* 5. Плашка «Избранное» в ряду категорий */
const chipsOld = `    const all = document.createElement('button');
    all.className = 'chip' + (activeCategory === 'all' ? ' active' : '');
    all.textContent = 'Все';`;

const chipsNew = `    const fav = document.createElement('button');
    fav.className = 'chip chip-fav' + (activeCategory === 'favorites' ? ' active' : '');
    fav.textContent = '★ Избранное';
    fav.addEventListener('click', () => {
      activeCategory = 'favorites';
      renderChips();
      renderSearchView();
    });
    box.appendChild(fav);

    const all = document.createElement('button');
    all.className = 'chip' + (activeCategory === 'all' ? ' active' : '');
    all.textContent = 'Все';`;

if (!app.includes(chipsOld)) {
  console.error('Не нашёл renderChips');
  process.exit(1);
}

app = app.replace(chipsOld, chipsNew);

/* 6. Звёздочка в строке материала */
const starOld = `    group.append(toPaint, toMaterials);
    li.append(text, group);`;

const starNew = `    const star = document.createElement('button');
    star.className = 'star' + (isFavorite(item.code) ? ' active' : '');
    star.textContent = isFavorite(item.code) ? '★' : '☆';
    star.title = isFavorite(item.code) ? 'Убрать из избранного' : 'В избранное';
    star.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(item.code);
    });

    group.append(star, toPaint, toMaterials);
    li.append(text, group);`;

if (!app.includes(starOld)) {
  console.error('Не нашёл кнопки строки');
  process.exit(1);
}

app = app.replace(starOld, starNew);

/* 7. Кнопка сброса остатков */
const bindOld = `    $('#clearSearchToggle').addEventListener('change', (e) => {
      store.set(LS_TOGGLE, e.target.checked);
    });`;

const bindNew = `    $('#clearSearchToggle').addEventListener('change', (e) => {
      store.set(LS_TOGGLE, e.target.checked);
    });

    const resetButton = $('#btnResetStock');
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        if (!confirm('Вернуть остатки как в отчёте от 16.11.2026? Всё списанное снова появится на складе.')) return;

        resetStock();
        renderSearchView();
        toast('Остатки восстановлены по отчёту');
      });
    }`;

if (!app.includes(bindOld)) {
  console.error('Не нашёл привязку событий');
  process.exit(1);
}

app = app.replace(bindOld, bindNew);

fs.writeFileSync(appFile, app);
console.log('избранное и постоянный остаток подключены');
