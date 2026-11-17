'use strict';

/*
 * Быстрый набор по деталям: только готовые краски, компактный вид.
 * Скрипт правит server/public/app.js.
 *
 *   node tools/patch-quick-recipe-ui.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

if (src.includes('loadQuickRecipes')) {
  console.log('уже пропатчено');
  process.exit(0);
}

let changed = 0;

/* ---------- 1. Разметка ---------- */

const oldBox = [
  '          <div class="quick-box" id="quickBox">',
  '            <div class="quick-head">Быстрый набор по деталям</div>',
  '            <div class="quick-row">',
  '              <input type="text" id="quickPaint" placeholder="Краска: код или название" autocomplete="off">',
  '              <input type="number" id="quickParts" value="1" min="0.1" step="0.05" title="Сколько деталей">',
  '              <button class="btn btn-outline btn-sm" id="btnQuick">Подобрать</button>',
  '            </div>',
  '            <div class="search-results hidden" id="quickPaintResults"></div>',
  '            <div id="quickResult"></div>',
  '          </div>'
].join('\n');

const newBox = [
  '          <div class="quick-box" id="quickBox">',
  '            <div class="quick-row">',
  '              <select id="quickRecipe" class="quick-select" title="Готовая краска"></select>',
  '              <input type="number" id="quickParts" value="1" min="0.1" step="0.05" title="Сколько деталей" class="quick-parts">',
  '              <button class="btn btn-outline btn-sm" id="btnQuick">Списать</button>',
  '            </div>',
  '            <div id="quickResult"></div>',
  '          </div>'
].join('\n');

if (!src.includes(oldBox)) {
  console.error('не нашёл разметку быстрого набора');
  process.exit(1);
}

src = src.replace(oldBox, newBox);
changed++;
console.log('разметка обновлена');

/* ---------- 2. Инициализация ---------- */

const oldInit = [
  '    let quickPaintItem = null;',
  '',
  "    if ($('#btnQuick')) {",
  "      $('#btnQuick').addEventListener('click', () => quickPreview(quickPaintItem));",
  '    }',
  '',
  "    const quickPaint = $('#quickPaint');",
  '',
  '    if (quickPaint) {',
  '      let quickTimer = null;',
  '',
  "      quickPaint.addEventListener('input', () => {",
  '        clearTimeout(quickTimer);',
  '        quickTimer = setTimeout(() => quickPickPaint(quickPaint.value.trim(), (item) => {',
  '          quickPaintItem = item;',
  '          quickPaint.value = item.name;',
  "          $('#quickPaintResults').classList.add('hidden');",
  '        }), 220);',
  '      });',
  '    }'
].join('\n');

const newInit = [
  '    // Быстрый набор работает только с готовыми красками',
  '    loadQuickRecipes();',
  '',
  "    if ($('#btnQuick')) {",
  "      $('#btnQuick').addEventListener('click', quickPreview);",
  '    }',
  '',
  "    if ($('#quickRecipe')) {",
  "      $('#quickRecipe').addEventListener('change', () => {",
  "        const result = $('#quickResult');",
  "        if (result) result.innerHTML = '';",
  '      });',
  '    }',
  '',
  "    if ($('#quickParts')) {",
  "      $('#quickParts').addEventListener('keydown', (event) => {",
  "        if (event.key === 'Enter') quickPreview();",
  '      });',
  '    }'
].join('\n');

if (!src.includes(oldInit)) {
  console.error('не нашёл инициализацию быстрого набора');
  process.exit(1);
}

src = src.replace(oldInit, newInit);
changed++;
console.log('инициализация обновлена');

/* ---------- 3. Убираем поиск краски ---------- */

const searchStart = src.indexOf('  /** Выбор краски для наряда: по коду или названию. */');

if (searchStart > 0) {
  const searchEnd = src.indexOf('    async function quickPreview(', searchStart);

  if (searchEnd > searchStart) {
    src = src.slice(0, searchStart) + src.slice(searchEnd);
    changed++;
    console.log('старый поиск краски удалён');
  }
}

/* ---------- 4. Новые функции ---------- */

const previewStart = src.indexOf('async function quickPreview(');
const previewEnd = src.indexOf('/* ---- Нормы списания: свой набор у каждого маляра', previewStart);

if (previewStart < 0 || previewEnd < 0) {
  console.error('не нашёл quickPreview');
  process.exit(1);
}

const newPreview = [
  '    /** Список готовых красок для быстрого набора. */',
  '    async function loadQuickRecipes() {',
  "      const select = $('#quickRecipe');",
  '      if (!select) return;',
  '',
  '      try {',
  "        const data = await api('/api/recipes');",
  '        const recipes = data.recipes || [];',
  '',
  '        if (!recipes.length) {',
  "          select.innerHTML = '<option value=\"\">Готовых красок нет</option>';",
  '          select.disabled = true;',
  '',
  "          if ($('#btnQuick')) $('#btnQuick').disabled = true;",
  '',
  "          const result = $('#quickResult');",
  '          if (result) {',
  '            result.innerHTML = \'<div class="muted quick-hint">Сначала создайте готовую краску — вкладка «Готовые краски».</div>\';',
  '          }',
  '',
  '          return;',
  '        }',
  '',
  '        select.disabled = false;',
  "        if ($('#btnQuick')) $('#btnQuick').disabled = false;",
  '',
  "        select.innerHTML = recipes.map((row) => '<option value=\"' + esc(row.name) + '\">' + esc(row.name) + '</option>').join('');",
  '      } catch (error) {',
  "        select.innerHTML = '<option value=\"\">Не удалось загрузить</option>';",
  '        select.disabled = true;',
  '      }',
  '    }',
  '',
  '    async function quickPreview() {',
  "      const partsInput = $('#quickParts');",
  "      const result = $('#quickResult');",
  "      const select = $('#quickRecipe');",
  '',
  '      if (!result || !state.order) return;',
  '',
  "      const recipe = select ? select.value : '';",
  '',
  '      if (!recipe) {',
  '        result.innerHTML = \'<div class="muted quick-hint">Выберите готовую краску.</div>\';',
  '        return;',
  '      }',
  '',
  '      const parts = Number(partsInput.value) || 1;',
  '',
  '      result.innerHTML = \'<div class="muted quick-hint">Считаю…</div>\';',
  '',
  '      try {',
  '        const data = await api(`/api/norms/quick?parts=${encodeURIComponent(parts)}&recipe=${encodeURIComponent(recipe)}`);',
  '',
  '        if (!data.items.length) {',
  '          result.innerHTML = \'<div class="muted quick-hint">Нормы не заданы. Задайте их в разделе «Нормы списания».</div>\';',
  '          return;',
  '        }',
  '',
  '        result.innerHTML = `',
  '          <div class="quick-list">',
  '            ${data.items.map((item) => `',
  '              <div class="quick-line">',
  '                <span>${esc(item.name)}</span>',
  '                <span class="mono">${qty(item.qty)} ${esc(item.unit)}${item.per === \'order\' ? \' <span class="muted">на машину</span>\' : \'\'}</span>',
  '              </div>`).join(\'\')}',
  '          </div>',
  '          <button class="btn btn-primary btn-sm" id="btnQuickAdd" style="width:100%;margin-top:6px">',
  '            Добавить в списание (${data.items.length})',
  '          </button>',
  '        `;',
  '',
  "        $('#btnQuickAdd').addEventListener('click', async () => {",
  "          const button = $('#btnQuickAdd');",
  '          button.disabled = true;',
  "          button.textContent = 'Добавляю…';",
  '',
  '          try {',
  '            for (const item of data.items) {',
  '              await api(`/api/orders/${state.order.id}/materials`, {',
  "                method: 'POST',",
  '                body: {',
  '                  code: item.code,',
  '                  name: item.name,',
  '                  unit: item.unit,',
  '                  qty: item.qty,',
  "                  kind: item.unit === 'г' ? 'paint' : 'material'",
  '                }',
  '              });',
  '            }',
  '',
  "            const fresh = await api('/api/orders/' + state.order.id);",
  '            state.order = fresh.order;',
  '            renderOrder();',
  '',
  '            toast(`Добавлено: ${qty(parts)} дет., краска «${data.recipe}»`);',
  '          } catch (error) {',
  '            toast(error.message);',
  '            button.disabled = false;',
  "            button.textContent = 'Добавить в списание';",
  '          }',
  '        });',
  '      } catch (error) {',
  '        result.innerHTML = `<div class="muted quick-hint">${esc(error.message)}</div>`;',
  '      }',
  '    }',
  '',
  ''
].join('\n');

src = src.slice(0, previewStart) + newPreview + src.slice(previewEnd);
changed++;
console.log('новые функции добавлены');

fs.writeFileSync(file, src);
console.log('изменений:', changed);
