'use strict';

/*
 * Быстрый набор: вместо выпадающего списка — поиск по готовым краскам.
 * Список готовых красок со временем станет большим, поиск удобнее.
 *
 *   node tools/patch-quick-search.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

if (src.includes('quickFilterRecipes')) {
  console.log('уже пропатчено');
  process.exit(0);
}

let changed = 0;

/* ---------- 1. Разметка: поле поиска вместо select ---------- */

const oldBox = [
  '          <div class="quick-box" id="quickBox">',
  '            <div class="quick-row">',
  '              <select id="quickRecipe" class="quick-select" title="Готовая краска"></select>',
  '              <input type="number" id="quickParts" value="1" min="0.1" step="0.05" title="Сколько деталей" class="quick-parts">',
  '              <button class="btn btn-outline btn-sm" id="btnQuick">Списать</button>',
  '            </div>',
  '            <div id="quickResult"></div>',
  '          </div>'
].join('\n');

const newBox = [
  '          <div class="quick-box" id="quickBox">',
  '            <div class="quick-row">',
  '              <div class="quick-search-wrap">',
  '                <input type="text" id="quickRecipe" class="quick-select" placeholder="Готовая краска: название" autocomplete="off">',
  '                <div class="search-results hidden" id="quickRecipeResults"></div>',
  '              </div>',
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
console.log('разметка: поле поиска');

/* ---------- 2. Инициализация: поиск при вводе ---------- */

const oldInit = [
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
  '      });",
  '    }'
].join('\n');

const newInit = [
  '    // Быстрый набор работает только с готовыми красками: ищем по названию',
  "    loadQuickRecipes();",
  '',
  "    if ($('#btnQuick')) {",
  "      $('#btnQuick').addEventListener('click', quickPreview);",
  '    }',
  '',
  "    const quickInput = $('#quickRecipe');",
  '',
  '    if (quickInput) {',
  '      let quickSearchTimer = null;',
  '',
  "      quickInput.addEventListener('input', () => {",
  '        quickRecipeName = \'\';',
  '        clearTimeout(quickSearchTimer);',
  '        quickSearchTimer = setTimeout(() => quickFilterRecipes(quickInput.value.trim()), 150);',
  '      });',
  '',
  "      quickInput.addEventListener('keydown', (event) => {",
  "        if (event.key === 'Enter') {",
  "          event.preventDefault();",
  '',
  "          const results = $('#quickRecipeResults');",
  '          const first = results && !results.classList.contains(\'hidden\')',
  "            ? results.querySelector('[data-quick-recipe]')",
  '            : null;',
  '',
  '          if (first) {',
  '            pickQuickRecipe(first.dataset.quickRecipe);',
  '          } else {',
  '            quickPreview();',
  '          }',
  '        }',
  '      });',
  '',
  "      quickInput.addEventListener('blur', () => {",
  '        setTimeout(() => {',
  "          const results = $('#quickRecipeResults');",
  "          if (results) results.classList.add('hidden');",
  '        }, 180);',
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
  console.error('не нашёл инициализацию');
  process.exit(1);
}

src = src.replace(oldInit, newInit);
changed++;
console.log('инициализация: поиск');

/* ---------- 3. Функции: загрузка, фильтр, выбор ---------- */

const loadStart = src.indexOf('  /** Список готовых красок для быстрого набора. */');
const loadEnd = src.indexOf('  async function quickPreview()', loadStart);

if (loadStart < 0 || loadEnd < 0) {
  console.error('не нашёл loadQuickRecipes');
  process.exit(1);
}

const newLoad = [
  '  /** Готовые краски держим в памяти: их может быть много. */',
  '  let quickRecipes = [];',
  '  let quickRecipeName = \'\';',
  '',
  '  async function loadQuickRecipes() {',
  '    try {',
  "      const data = await api('/api/recipes');",
  '      quickRecipes = data.recipes || [];',
  '',
  '      if (!quickRecipes.length) {',
  "        const input = $('#quickRecipe');",
  "        if (input) { input.disabled = true; input.placeholder = 'Готовых красок пока нет'; }",
  "        if ($('#btnQuick')) $('#btnQuick').disabled = true;",
  '',
  "        const result = $('#quickResult');",
  '        if (result) {',
  '          result.innerHTML = \'<div class="muted quick-hint">Сначала создайте готовую краску — вкладка «Готовые краски».</div>\';',
  '        }',
  '      }',
  '    } catch (error) {',
  "      const input = $('#quickRecipe');",
  "      if (input) { input.disabled = true; input.placeholder = 'Не удалось загрузить краски'; }",
  '    }',
  '  }',
  '',
  '  /** Подсказки по названию: ищем по всем готовым краскам. */',
  '  function quickFilterRecipes(term) {',
  "    const wrap = $('#quickRecipeResults');",
  '    if (!wrap) return;',
  '',
  '    const needle = term.toLowerCase();',
  '',
  '    const found = (needle',
  '      ? quickRecipes.filter((row) => String(row.name).toLowerCase().includes(needle))',
  '      : quickRecipes',
  '    ).slice(0, 8);',
  '',
  '    if (!found.length) {',
  "      wrap.innerHTML = '<div class=\"row\" style=\"cursor:default\">Краска не найдена</div>';",
  "      wrap.classList.remove('hidden');",
  '      return;',
  '    }',
  '',
  '    wrap.innerHTML = found.map((row) => `',
  '      <div class="row" data-quick-recipe="${esc(row.name)}">',
  '        <span class="name">${esc(row.name)}</span>',
  '        <span class="muted mono">${qty(row.base)} г</span>',
  '      </div>',
  "    `).join('');",
  '',
  "    wrap.classList.remove('hidden');",
  '',
  "    wrap.querySelectorAll('[data-quick-recipe]').forEach((element) => {",
  "      element.addEventListener('click', () => pickQuickRecipe(element.dataset.quickRecipe));",
  '    });',
  '  }',
  '',
  '  function pickQuickRecipe(name) {',
  "    const input = $('#quickRecipe');",
  "    const wrap = $('#quickRecipeResults');",
  "    const result = $('#quickResult');",
  '',
  "    if (input) input.value = name;",
  "    if (wrap) wrap.classList.add('hidden');",
  "    if (result) result.innerHTML = '';",
  '',
  '    quickRecipeName = name;',
  '  }',
  '',
  ''
].join('\n');

src = src.slice(0, loadStart) + newLoad + src.slice(loadEnd);
changed++;
console.log('функции поиска добавлены');

/* ---------- 4. quickPreview: берём выбранную краску ---------- */

const oldPick = [
  "    const partsInput = $('#quickParts');",
  "    const result = $('#quickResult');",
  "    const select = $('#quickRecipe');",
  '',
  '    if (!result || !state.order) return;',
  '',
  "    const recipe = select ? select.value : '';",
  '',
  '    if (!recipe) {',
  '      result.innerHTML = \'<div class="muted quick-hint">Выберите готовую краску.</div>\';',
  '      return;',
  '    }'
].join('\n');

const newPick = [
  "    const partsInput = $('#quickParts');",
  "    const result = $('#quickResult');",
  "    const input = $('#quickRecipe');",
  '',
  '    if (!result || !state.order) return;',
  '',
  '    // Краска должна быть выбрана из подсказок',
  "    const typed = input ? input.value.trim() : '';",
  '    const exact = quickRecipes.find((row) => String(row.name).toLowerCase() === typed.toLowerCase());',
  '    const recipe = quickRecipeName || (exact ? exact.name : \'\');',
  '',
  '    if (!recipe) {',
  '      result.innerHTML = \'<div class="muted quick-hint">Выберите готовую краску из подсказок.</div>\';',
  '      return;',
  '    }',
  '',
  '    quickRecipeName = recipe;'
].join('\n');

if (!src.includes(oldPick)) {
  console.error('не нашёл начало quickPreview');
  process.exit(1);
}

src = src.replace(oldPick, newPick);
changed++;
console.log('quickPreview обновлён');

fs.writeFileSync(file, src);
console.log('изменений:', changed);
