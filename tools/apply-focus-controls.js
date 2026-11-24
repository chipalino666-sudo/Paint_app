'use strict';

/*
 * В полноэкранном списании — управление как в отдельной программе:
 * фильтр по категориям, «очищать поиск при добавлении», ручное добавление.
 *
 *   node tools/apply-focus-controls.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

if (src.includes('renderMaterialChips')) {
  console.log('уже подключено');
  process.exit(0);
}

const anchor = '  async function searchMaterials(term) {';

const block = [
  '  /* --------------------------------------------------------------------',
  '     Фильтр по категориям, очистка поиска и ручное добавление',
  '     (как в отдельной программе для списания)',
  '     -------------------------------------------------------------------- */',
  '',
  '  const MATERIAL_CATEGORIES = [',
  "    ['paint', 'Краски'],",
  "    ['primer', 'Грунты'],",
  "    ['putty', 'Шпатлёвки'],",
  "    ['clear', 'Лаки'],",
  "    ['abrasive', 'Абразивы'],",
  "    ['thinner', 'Растворители'],",
  "    ['hardener', 'Отвердители'],",
  "    ['consumable', 'Расходники'],",
  "    ['other', 'Прочее']",
  '  ];',
  '',
  "  let materialCategory = 'all';",
  "  let clearAfterAdd = storeBool('paintShopClearAfterAdd', true);",
  '',
  '  function storeBool(key, fallback) {',
  '    try {',
  '      const value = localStorage.getItem(key);',
  "      return value === null ? fallback : value === '1';",
  '    } catch (error) {',
  '      return fallback;',
  '    }',
  '  }',
  '',
  '  function renderMaterialChips() {',
  "    const box = $('#matChips');",
  '    if (!box) return;',
  '',
  '    box.innerHTML = "";',
  '',
  '    const make = (id, label) => {',
  "      const chip = document.createElement('button');",
  "      chip.type = 'button';",
  "      chip.className = 'chip' + (materialCategory === id ? ' active' : '');",
  '      chip.textContent = label;',
  '      chip.addEventListener(\'click\', () => {',
  '        materialCategory = id;',
  '        renderMaterialChips();',
  "        searchMaterials($('#matSearch').value.trim());",
  '      });',
  '      box.appendChild(chip);',
  '    };',
  '',
  "    make('all', 'Все');",
  "    make('favorites', '★ Избранное');",
  '',
  '    for (const [id, label] of MATERIAL_CATEGORIES) make(id, label);',
  '  }',
  '',
  '  async function addManualMaterial(kind) {',
  "    const code = $('#manualCode').value.trim();",
  "    const name = $('#manualName').value.trim();",
  '',
  '    if (!name) {',
  "      toast('Введите наименование');",
  '      return;',
  '    }',
  '',
  '    await addMaterial({',
  "      code: code || 'MAN-' + Date.now().toString(36).toUpperCase(),",
  '      name,',
  "      unit: kind === 'paint' ? 'г' : 'шт'",
  '    }, kind);',
  '',
  "    $('#manualCode').value = '';",
  "    $('#manualName').value = '';",
  '  }',
  '',
  anchor
].join('\n');

if (!src.includes(anchor)) {
  console.error('Не нашёл searchMaterials');
  process.exit(1);
}

src = src.replace(anchor, block);

/* Фильтрация по категории */
src = src.replace(
  '      data.materials.forEach((item) => wrap.appendChild(materialRow(item)));',
  [
    '      const list = materialCategory === \'all\'',
    '        ? data.materials',
    '        : data.materials.filter((item) => materialCategory === \'favorites\'',
    '          ? favorites.has(item.code)',
    '          : item.category === materialCategory);',
    '',
    "      if (!list.length) {",
    "        wrap.innerHTML = '<div class=\"row\" style=\"cursor:default\">В этой категории ничего нет</div>';",
    '        wrap.classList.remove(\'hidden\');',
    '        return;',
    '      }',
    '',
    '      list.forEach((item) => wrap.appendChild(materialRow(item)));'
  ].join('\n')
);

/* После добавления — очистка поиска, если включена */
src = src.replace(
  '  async function addMaterial(item, kind) {',
  [
    '  async function addMaterial(item, kind) {',
    '    const clearSearch = clearAfterAdd;'
  ].join('\n')
);

fs.writeFileSync(file, src);
console.log('фильтры и ручное добавление подключены');
