'use strict';

/*
 * Добавляет в бланковую программу остатки: показ в поиске и вычет того,
 * что уже стоит в бланке.
 *
 *   node tools/apply-stock.js <папка PaintApp_mini>
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const appFile = path.join(root, 'app.js');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

if (app.includes('function stockLabel(')) {
  console.log('остатки уже подключены');
  process.exit(0);
}

// 1. Помощники остатков
const anchor1 = '  const isMobile = () => window.innerWidth <= 768;';

const helpers = `${anchor1}

  /* ----------------------------------------------------------------------
     Остатки
     Остаток = что было на складе минус то, что уже стоит в бланке.
     ---------------------------------------------------------------------- */

  function stockInfo(code) {
    const item = database.find((i) => i.code === code);
    if (!item || typeof item.stock !== 'number') return null;

    return { base: item.stock, unit: item.unit || '' };
  }

  function usedInForm(code) {
    let sum = 0;

    document.querySelectorAll('#table-paint tbody tr, #table-materials tbody tr').forEach((row) => {
      if (row.dataset.code !== code) return;

      const input = row.querySelector('input');
      sum += parseFloat(input && input.value ? input.value : 0) || 0;
    });

    return round2(sum);
  }

  function formatStock(value, unit) {
    const text = Math.abs(value) >= 1000
      ? value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
      : fmt(value);

    return unit ? text + ' ' + unit : text;
  }

  function stockLabel(code) {
    const info = stockInfo(code);
    if (!info) return { text: '', left: null };

    const used = usedInForm(code);
    const left = round2(info.base - used);

    const text = used > 0
      ? \`остаток \${formatStock(left, info.unit)} · списано \${formatStock(used, info.unit)}\`
      : \`остаток \${formatStock(info.base, info.unit)}\`;

    return { text, left };
  }

  function refreshStockLabels() {
    document.querySelectorAll('#resultsWrap [data-stock-for]').forEach((el) => {
      const label = stockLabel(el.dataset.stockFor);

      el.textContent = label.text;
      el.classList.toggle('stock-empty', label.left !== null && label.left <= 0);
    });
  }`;

if (!app.includes(anchor1)) {
  console.error('Не нашёл isMobile');
  process.exit(1);
}

app = app.replace(anchor1, helpers);

// 2. Строка поиска: показываем остаток
const oldAppend = `    const alias = paintAliasOf(item.name);
    code.textContent = alias ? item.code + ' · ' + alias : item.code;

    text.append(name, code);`;

const newAppend = `    const alias = paintAliasOf(item.name);
    code.textContent = alias ? item.code + ' · ' + alias : item.code;

    const stock = document.createElement('div');
    stock.className = 'stock';
    stock.dataset.stockFor = item.code;
    stock.textContent = stockLabel(item.code).text;

    text.append(name, code, stock);`;

if (!app.includes(oldAppend)) {
  console.error('Не нашёл строку результата');
  process.exit(1);
}

app = app.replace(oldAppend, newAppend);

// 3. Пересчитываем остаток при правке количества
const oldInput = `    input.addEventListener('input', saveForm);`;
const newInput = `    input.addEventListener('input', () => {
      saveForm();
      refreshStockLabels();
    });`;

if (app.includes(oldInput)) app = app.replace(oldInput, newInput);

// 4. Обновляем цифры после добавления
const oldAfter = `    rememberUsage(code, name, table);
    saveForm();
  }`;

const newAfter = `    rememberUsage(code, name, table);
    saveForm();
    refreshStockLabels();
  }`;

if (!app.includes(oldAfter)) {
  console.error('Не нашёл addToReport');
  process.exit(1);
}

app = app.replace(oldAfter, newAfter);

fs.writeFileSync(appFile, app);
console.log('остатки подключены');
