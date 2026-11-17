'use strict';

/*
 * Клиентская часть остатков и избранного для CRM:
 *   - в результатах поиска материалов видно остаток и звёздочку;
 *   - кнопка «★ Избранное» показывает только отмеченные материалы.
 *
 *   node tools/apply-crm-client.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

let changed = 0;

/* 1. Строка результата — отдельной функцией, с остатком и звёздочкой */
const oldLoop = `      data.materials.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = \`
          <span class="code">\${esc(item.code)}</span>
          <span class="name">\${esc(item.name)}\${item.aliases ? \`<br><span class="muted">\${esc(item.aliases)}</span>\` : ''}</span>
          <button class="btn btn-left btn-sm" data-kind="paint">◀ Эмаль</button>
          <button class="btn btn-right btn-sm" data-kind="material">Материал ▶</button>
        \`;

        row.querySelectorAll('button').forEach((button) => {
          button.addEventListener('click', async (event) => {
            event.stopPropagation();
            await addMaterial(item, button.dataset.kind);
          });
        });

        wrap.appendChild(row);
      });`;

const newLoop = `      data.materials.forEach((item) => wrap.appendChild(materialRow(item)));`;

if (src.includes(oldLoop)) {
  src = src.replace(oldLoop, newLoop);
  changed++;
  console.log('app.js: строка результата вынесена в функцию');
} else {
  console.log('app.js: цикл вывода не найден');
}

/* 2. Новая функция строки + работа с избранным */
const anchor = '  async function addMaterial(item, kind) {';

const block = `  /* Избранные материалы: у каждого сотрудника свои */
  let favorites = new Set();
  let favoritesLoaded = false;

  function numberText(value, unit) {
    const number = Math.abs(Number(value) || 0) >= 1000
      ? Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
      : String(Math.round((Number(value) || 0) * 100) / 100);

    return unit ? number + ' ' + unit : number;
  }

  async function loadFavorites() {
    if (favoritesLoaded) return favorites;

    try {
      const data = await api('/api/favorites');
      favorites = new Set((data.favorites || []).map((row) => row.code));
    } catch (error) {
      favorites = new Set();
    }

    favoritesLoaded = true;
    return favorites;
  }

  async function toggleFavorite(code) {
    const isFav = favorites.has(code);

    try {
      if (isFav) {
        await api('/api/favorites/' + encodeURIComponent(code), { method: 'DELETE' });
        favorites.delete(code);
      } else {
        await api('/api/favorites', { method: 'POST', body: { code } });
        favorites.add(code);
      }

      return !isFav;
    } catch (error) {
      toast(error.message);
      return isFav;
    }
  }

  function materialRow(item) {
    const row = document.createElement('div');
    row.className = 'row';

    const left = Number(item.stock_left);
    const unit = item.unit || '';

    const stockText = Number.isFinite(left)
      ? 'осталось ' + numberText(left, unit)
      : '';

    const stockClass = Number.isFinite(left) && left <= 0 ? 'stock-badge empty' : 'stock-badge';

    row.innerHTML = \`
      <span class="code">\${esc(item.code)}</span>
      <span class="name">\${esc(item.name)}\${item.aliases ? \`<br><span class="muted">\${esc(item.aliases)}</span>\` : ''}\${stockText ? \`<br><span class="\${stockClass}">\${esc(stockText)}</span>\` : ''}</span>
      <button class="fav-star\${favorites.has(item.code) ? ' active' : ''}" title="В избранное">\${favorites.has(item.code) ? '★' : '☆'}</button>
      <button class="btn btn-left btn-sm" data-kind="paint">◀ Эмаль</button>
      <button class="btn btn-right btn-sm" data-kind="material">Материал ▶</button>
    \`;

    row.querySelector('.fav-star').addEventListener('click', async (event) => {
      event.stopPropagation();

      const button = event.currentTarget;
      const nowFav = await toggleFavorite(item.code);

      button.textContent = nowFav ? '★' : '☆';
      button.classList.toggle('active', nowFav);
    });

    row.querySelectorAll('[data-kind]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        await addMaterial(item, button.dataset.kind);
      });
    });

    return row;
  }

  async function showFavorites(wrap) {
    await loadFavorites();

    wrap.innerHTML = '<div class="row" style="cursor:default">Загрузка…</div>';
    wrap.classList.remove('hidden');

    try {
      const data = await api('/api/favorites');
      wrap.innerHTML = '';

      if (!data.favorites.length) {
        wrap.innerHTML = '<div class="row" style="cursor:default">Пока пусто — отметьте материалы звёздочкой</div>';
        return;
      }

      data.favorites.forEach((item) => wrap.appendChild(materialRow(item)));
    } catch (error) {
      wrap.innerHTML = \`<div class="row" style="cursor:default">\${esc(error.message)}</div>\`;
    }
  }

${anchor}`;

if (src.includes(anchor)) {
  src = src.replace(anchor, block);
  changed++;
  console.log('app.js: функция строки и избранное');
} else {
  console.log('app.js: addMaterial не найден');
}

/* 3. Кнопка «Избранное» в панели списания */
const oldTabs = `      <div class="mode-tabs">
        <button data-mode="materials" class="active">Материалы</button>
        <button data-mode="recipes">Готовые краски</button>
      </div>`;

const newTabs = `      <div class="mode-tabs">
        <button data-mode="materials" class="active">Материалы</button>
        <button data-mode="recipes">Готовые краски</button>
        <button data-mode="favorites" id="btnFavorites">★ Избранное</button>
      </div>`;

if (src.includes(oldTabs)) {
  src = src.replace(oldTabs, newTabs);
  changed++;
  console.log('app.js: кнопка избранного');
}

/* 4. Переключение режима с избранным */
const oldSwitch = `        $('#addSearchWrap').classList.toggle('hidden', mode !== 'materials');
        $('#addRecipeWrap').classList.toggle('hidden', mode !== 'recipes');
        if (mode === 'recipes') renderRecipeSearch('');`;

const newSwitch = `        $('#addSearchWrap').classList.toggle('hidden', mode === 'recipes');
        $('#addRecipeWrap').classList.toggle('hidden', mode !== 'recipes');

        if (mode === 'recipes') renderRecipeSearch('');
        else if (mode === 'favorites') showFavorites($('#matResults'));
        else searchMaterials($('#matSearch').value.trim());`;

if (src.includes(oldSwitch)) {
  src = src.replace(oldSwitch, newSwitch);
  changed++;
  console.log('app.js: переключение режимов');
}



fs.writeFileSync(file, src);
console.log('изменений:', changed);
