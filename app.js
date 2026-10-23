/* ==========================================================================
   Заказ-наряд малярного цеха — логика приложения
   --------------------------------------------------------------------------
   Структура:
     1. Хранилище (localStorage)
     2. Утилиты
     3. Бланк: строки таблиц, количество, удаление
     4. Поиск, категории, часто используемые
     5. Готовые краски (шаблоны) и их калькулятор
     6. Редактор шаблонов
     7. Печать / PDF
   ========================================================================== */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const LS_FORM = 'paintShopFormData';       // черновик бланка
  const LS_RECIPES = 'paintShopRecipes';     // шаблоны готовых красок
  const LS_USAGE = 'paintShopUsage';         // счётчик частых материалов
  const LS_TOGGLE = 'paintShopClearToggle';  // галочка «очищать поиск»
  const LS_MODE = 'paintShopSearchMode';     // выбранный режим поиска
  const LS_DIRTY = 'paintShopDirty';         // сколько изменений без резервной копии
  const LS_EXPORTED = 'paintShopLastExport'; // когда последний раз выгружали копию

  const MAX_RESULTS = 30;
  const MAX_FREQUENT = 8;

  const CATEGORY_LABELS = {
    paint: 'Краски',
    primer: 'Грунты',
    putty: 'Шпатлёвки',
    clear: 'Лаки',
    abrasive: 'Абразивы',
    thinner: 'Растворители',
    hardener: 'Отвердители',
    consumable: 'Расходники',
    other: 'Прочее'
  };

  /* ----------------------------------------------------------------------
     1. Хранилище
     ---------------------------------------------------------------------- */

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        console.warn('Не читается хранилище:', key, e);
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn('Не пишется в хранилище:', key, e);
        toast('Браузер не разрешает сохранить данные. Освободите место или откройте в обычном режиме.');
        return false;
      }
    }
  };

  /* ----------------------------------------------------------------------
     2. Утилиты
     ---------------------------------------------------------------------- */

  /** Округление до 0,01 г без ошибок плавающей точки. */
  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  /** Число для человека: 210, 210.4, 210.45 — без хвостовых нулей. */
  function fmt(n) {
    const r = round2(n);
    let s = String(r);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  /** Короткое имя для таблицы (в PDF идут узкие колонки). */
  function shortenName(name) {
    return String(name)
      .replace(/^Краска\s+(Brulex|Normex)\s+MIX\s+/i, '$1 ')
      .replace(/^Краска\s+/i, '');
  }

  function categoryOf(code) {
    if (typeof ITEM_CATEGORY !== 'undefined' && ITEM_CATEGORY[code]) return ITEM_CATEGORY[code];
    return 'other';
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  const isMobile = () => window.innerWidth <= 768;

  /* ----------------------------------------------------------------------
     3. Бланк
     ---------------------------------------------------------------------- */

  const tableBody = (table) =>
    document.querySelector(table === 'paint' ? '#table-paint tbody' : '#table-materials tbody');

  /**
   * Добавляет материал в бланк.
   * Если такой код уже есть — увеличивает количество, а не дублирует строку.
   */
  function addToReport(code, name, table, amount = 1) {
    const tbody = tableBody(table);
    const existing = [...tbody.rows].find((row) => row.dataset.code === code);

    if (existing) {
      const input = existing.querySelector('input');
      input.value = fmt(round2(parseFloat(input.value || 0) + amount));
    } else {
      appendRow(tbody, code, shortenName(name), name, amount);
    }

    rememberUsage(code, name, table);
    saveForm();
  }

  function appendRow(tbody, code, shortName, fullName, amount) {
    const tr = document.createElement('tr');
    tr.dataset.code = code;

    const tdCode = document.createElement('td');
    tdCode.className = 'cell-code';
    tdCode.textContent = code;

    const tdName = document.createElement('td');
    tdName.className = 'cell-name';
    tdName.textContent = shortName;
    if (fullName && fullName !== shortName) tdName.title = fullName;

    const tdQty = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = '0';
    input.value = fmt(amount);
    input.addEventListener('input', saveForm);
    tdQty.appendChild(input);

    const tdDel = document.createElement('td');
    tdDel.className = 'action-col';
    tdDel.style.textAlign = 'center';
    const del = document.createElement('button');
    del.className = 'btn-del';
    del.textContent = '×';
    del.title = 'Удалить строку';
    del.addEventListener('click', () => {
      tr.remove();
      saveForm();
    });
    tdDel.appendChild(del);

    tr.append(tdCode, tdName, tdQty, tdDel);
    tbody.appendChild(tr);
  }

  function saveForm() {
    const data = {
      orderNum: $('#orderNum').value,
      carModel: $('#carModel').value,
      vin: $('#vin').value,
      master: $('#master').value,
      paintRows: [],
      materialRows: []
    };

    document.querySelectorAll('#table-paint tbody tr').forEach((tr) => {
      data.paintRows.push(readRow(tr));
    });
    document.querySelectorAll('#table-materials tbody tr').forEach((tr) => {
      data.materialRows.push(readRow(tr));
    });

    store.set(LS_FORM, data);
  }

  function readRow(tr) {
    return {
      code: tr.dataset.code || tr.cells[0].textContent,
      name: tr.cells[1].textContent,
      fullName: tr.cells[1].getAttribute('title') || tr.cells[1].textContent,
      qty: tr.querySelector('input').value
    };
  }

  function loadForm() {
    const data = store.get(LS_FORM, null);
    if (!data) return;

    $('#orderNum').value = data.orderNum || '';
    $('#carModel').value = data.carModel || '';
    $('#vin').value = data.vin || '';
    $('#master').value = data.master || '';

    const paintBody = document.querySelector('#table-paint tbody');
    const materialBody = document.querySelector('#table-materials tbody');
    paintBody.innerHTML = '';
    materialBody.innerHTML = '';

    (data.paintRows || []).forEach((r) => appendRow(paintBody, r.code, r.name, r.fullName, r.qty || 1));
    (data.materialRows || []).forEach((r) => appendRow(materialBody, r.code, r.name, r.fullName, r.qty || 1));
  }

  function clearAll() {
    if (!confirm('Начать новый заказ-наряд? Данные сотрутся.')) return;

    ['orderNum', 'carModel', 'vin', 'master'].forEach((id) => { $('#' + id).value = ''; });
    document.querySelector('#table-paint tbody').innerHTML = '';
    document.querySelector('#table-materials tbody').innerHTML = '';
    try { localStorage.removeItem(LS_FORM); } catch (e) { /* нечего чистить */ }

    toast('Бланк очищен');
  }

  /* ----------------------------------------------------------------------
     4. Поиск, категории, часто используемые
     ---------------------------------------------------------------------- */

  let activeCategory = 'all';
  let searchMode = 'materials';
  let usage = {};

  function applyModeUi() {
    $$('.mode-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === searchMode);
    });

    $('#search').placeholder =
      searchMode === 'recipes' ? 'Название цвета или код микса…' : 'Код, название материала…';
  }

  function setSearchMode(mode) {
    searchMode = mode === 'recipes' ? 'recipes' : 'materials';
    store.set(LS_MODE, searchMode);
    $('#search').value = '';
    applyModeUi();
    renderSearchView();
  }

  function rememberUsage(code, name, table) {
    if (!code || code === '—') return;
    const prev = usage[code] || { n: 0, table, name };
    usage[code] = { n: prev.n + 1, table, name };
    store.set(LS_USAGE, usage);
  }

  function renderChips() {
    const box = $('#categoryChips');
    box.innerHTML = '';

    const all = document.createElement('button');
    all.className = 'chip' + (activeCategory === 'all' ? ' active' : '');
    all.textContent = 'Все';
    all.addEventListener('click', () => {
      activeCategory = 'all';
      renderChips();
      renderSearchView();
    });
    box.appendChild(all);

    Object.entries(CATEGORY_LABELS).forEach(([id, label]) => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (activeCategory === id ? ' active' : '');
      chip.textContent = label;
      chip.addEventListener('click', () => {
        activeCategory = id;
        renderChips();
        renderSearchView();
      });
      box.appendChild(chip);
    });
  }

  function filteredItems(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return database.filter((item) => {
      if (activeCategory !== 'all' && categoryOf(item.code) !== activeCategory) return false;
      const text = (item.code + ' ' + item.name).toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }

  function makeItemRow(item) {
    const li = document.createElement('li');

    const text = document.createElement('div');
    text.className = 'item-text';

    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = item.name;

    const code = document.createElement('div');
    code.className = 'code';
    code.textContent = item.code;

    text.append(name, code);

    const group = document.createElement('div');
    group.className = 'btn-group';

    const toPaint = document.createElement('button');
    toPaint.className = 'btn-left';
    toPaint.textContent = '◀ Эмаль';
    toPaint.addEventListener('click', () => {
      addToReport(item.code, item.name, 'paint', 1);
      afterAdd();
    });

    const toMaterials = document.createElement('button');
    toMaterials.className = 'btn-right';
    toMaterials.textContent = 'Материал ▶';
    toMaterials.addEventListener('click', () => {
      addToReport(item.code, item.name, 'materials', 1);
      afterAdd();
    });

    group.append(toPaint, toMaterials);
    li.append(text, group);
    return li;
  }

  function sectionTitle(text) {
    const el = document.createElement('div');
    el.className = 'section-title';
    el.textContent = text;
    return el;
  }

  function renderFrequent() {
    const wrap = $('#frequentWrap');
    wrap.innerHTML = '';

    const top = Object.entries(usage)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, MAX_FREQUENT);

    if (!top.length) return;

    const list = document.createElement('ul');
    list.className = 'list';
    top.forEach(([code, info]) => {
      const known = database.find((i) => i.code === code);
      list.appendChild(makeItemRow({ code, name: info.name || (known ? known.name : code) }));
    });

    wrap.append(sectionTitle('Часто используемые'), list);
  }

  function renderSearchView() {
    const query = $('#search').value.trim();
    const resultsWrap = $('#resultsWrap');
    const frequentWrap = $('#frequentWrap');
    const chips = $('#categoryChips');

    resultsWrap.innerHTML = '';

    // Готовые краски живут в отдельном режиме поиска и не мешают материалам
    if (searchMode === 'recipes') {
      chips.style.display = 'none';
      frequentWrap.style.display = 'none';
      $('#manualBlock').style.display = 'none';
      renderRecipeList(query);
      return;
    }

    chips.style.display = '';
    $('#manualBlock').style.display = '';

    const showFrequent = !query && activeCategory === 'all';
    frequentWrap.style.display = showFrequent ? '' : 'none';
    if (showFrequent) renderFrequent();

    if (!query && activeCategory === 'all') return;

    if (query) {
      appendItemList(resultsWrap, filteredItems(query), 'Ничего не найдено. Проверьте код или добавьте вручную.');
      return;
    }

    appendItemList(resultsWrap, filteredItems(''), null);
  }

  function renderRecipeList(query) {
    const resultsWrap = $('#resultsWrap');
    const q = query.toLowerCase();

    if (!recipes.length) {
      resultsWrap.appendChild(recipeEmptyState());
      return;
    }

    // Ищем и по названию цвета, и по миксам — так видно, куда входит нужный пигмент
    const matched = recipes.filter((recipe) => {
      if (!q) return true;
      if (recipe.name.toLowerCase().includes(q)) return true;
      return recipe.mixes.some((mix) => (mix.code + ' ' + mix.name).toLowerCase().includes(q));
    });

    if (!matched.length) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'Такого готового цвета нет. Проверьте название или код микса.';
      resultsWrap.appendChild(note);
      return;
    }

    matched.forEach((recipe) => resultsWrap.appendChild(makeRecipeCard(recipe)));
  }

  function recipeEmptyState() {
    const box = document.createElement('div');
    box.className = 'empty-note';

    const text = document.createElement('div');
    text.textContent =
      'Шаблонов пока нет. Соберите первый готовый цвет — дальше его миксы будут считаться сами.';

    const button = document.createElement('button');
    button.className = 'btn-primary';
    button.style.marginTop = '12px';
    button.textContent = '＋ Новый шаблон';
    button.addEventListener('click', () => {
      openRecipesModal();
      startEdit(null);
    });

    box.append(text, button);
    return box;
  }

  function appendItemList(container, items, emptyText) {
    const limited = items.slice(0, MAX_RESULTS);

    if (limited.length) {
      const list = document.createElement('ul');
      list.className = 'list';
      limited.forEach((item) => list.appendChild(makeItemRow(item)));
      container.appendChild(list);
      return;
    }

    if (emptyText) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = emptyText;
      container.appendChild(note);
    }
  }

  function afterAdd() {
    const shouldClear = $('#clearSearchToggle').checked;
    if (shouldClear) {
      $('#search').value = '';
      renderSearchView();
      if (isMobile()) switchTab('form');
    }
  }

  /* ----------------------------------------------------------------------
     5. Готовые краски (шаблоны)
     ---------------------------------------------------------------------- */

  let recipes = [];
  let backupDirty = 0;    // изменений, которых нет в файле-копии
  let lastExportAt = 0;   // время последнего экспорта (0 — копии не было)

  function loadRecipes() {
    const saved = store.get(LS_RECIPES, null);
    if (Array.isArray(saved)) {
      recipes = saved;
    } else {
      recipes = typeof RECIPES_SEED !== 'undefined' ? JSON.parse(JSON.stringify(RECIPES_SEED)) : [];
      store.set(LS_RECIPES, recipes);
    }
  }

  function persistRecipes() {
    store.set(LS_RECIPES, recipes);
  }

  function newId() {
    return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /** Пересчёт миксов на нужный объём. */
  function scaleRecipe(recipe, volume) {
    const k = Number(volume) / Number(recipe.base);
    return recipe.mixes.map((m) => ({
      code: m.code,
      name: m.name,
      amount: round2(m.amount * k)
    }));
  }

  function applyRecipe(recipe, volume) {
    const v = Number(volume);
    if (!(v > 0)) {
      toast('Введите количество больше нуля');
      return;
    }

    const parts = scaleRecipe(recipe, v);
    parts.forEach((p) => addToReport(p.code, p.name, 'paint', p.amount));

    const summary = parts.map((p) => `${shortenName(p.name)} — ${fmt(p.amount)}`).join(', ');
    toast(`${recipe.name}: ${summary}`);

    const shouldClear = $('#clearSearchToggle').checked;
    if (shouldClear) {
      $('#search').value = '';
      renderSearchView();
      if (isMobile()) switchTab('form');
    }
  }

  function makeRecipeCard(recipe) {
    const card = document.createElement('div');
    card.className = 'recipe-card';

    const head = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'готовый цвет';
    const name = document.createElement('span');
    name.className = 'recipe-name';
    name.textContent = recipe.name;
    head.append(badge, name);

    const mixes = document.createElement('div');
    mixes.className = 'recipe-mixes';
    mixes.textContent =
      `Состав на ${fmt(recipe.base)} ${recipe.unit}: ` +
      recipe.mixes.map((m) => `${shortenName(m.name)} ${fmt(m.amount)}`).join(' · ');

    const add = document.createElement('div');
    add.className = 'recipe-add';

    const volume = document.createElement('input');
    volume.type = 'number';
    volume.min = '0.01';
    volume.step = '0.01';
    volume.value = fmt(recipe.base);
    volume.title = 'Сколько нужно приготовить';
    volume.setAttribute('aria-label', 'Объём готовой краски');

    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = recipe.unit;

    const button = document.createElement('button');
    button.className = 'btn-left';
    button.textContent = '→ В бланк';

    const preview = document.createElement('div');
    preview.className = 'recipe-preview';

    const updatePreview = () => {
      const v = Number(volume.value);
      if (!(v > 0)) {
        preview.textContent = '';
        return;
      }
      const parts = scaleRecipe(recipe, v);
      preview.textContent = 'Получится: ' + parts.map((p) => `${shortenName(p.name)} — ${fmt(p.amount)} ${recipe.unit}`).join(' · ');
    };

    volume.addEventListener('input', updatePreview);
    button.addEventListener('click', () => applyRecipe(recipe, volume.value));
    volume.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyRecipe(recipe, volume.value);
    });

    updatePreview();
    add.append(volume, unit, button);
    card.append(head, mixes, add, preview);
    return card;
  }

  /* ----------------------------------------------------------------------
     6. Редактор шаблонов
     ---------------------------------------------------------------------- */

  let editingId = null;
  let draftMixes = [];

  function openRecipesModal() {
    $('#recipesModal').classList.add('open');
    showRecipesList();
  }

  function closeRecipesModal() {
    $('#recipesModal').classList.remove('open');
    showRecipesList();
  }

  function showRecipesList() {
    $('#editorView').style.display = 'none';
    $('#recipesView').style.display = '';
    renderRecipesList();
  }

  function showEditor() {
    $('#recipesView').style.display = 'none';
    $('#editorView').style.display = '';
  }

  function markDirty() {
    backupDirty += 1;
    store.set(LS_DIRTY, backupDirty);
  }

  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  /**
   * Напоминание о резервной копии.
   * Краски хранятся только в браузере, поэтому пока в файл не выгружено —
   * висит жёлтая полоса с кнопкой. Выгрузили — полоса становится серой.
   */
  function renderBackupNotice() {
    const box = $('#backupNotice');
    if (!box) return;

    box.innerHTML = '';

    if (backupDirty > 0) {
      box.className = 'backup-notice warn';

      const text = document.createElement('div');
      text.className = 'backup-text';

      if (lastExportAt) {
        const date = new Date(lastExportAt).toLocaleDateString('ru-RU');
        text.textContent =
          `⚠ С последней копии (${date}) ${backupDirty} ` +
          plural(backupDirty, 'изменение', 'изменения', 'изменений') +
          '. Шаблоны хранятся только в этом браузере.';
      } else {
        text.textContent =
          '⚠ Резервной копии ещё нет. Шаблоны хранятся только в этом браузере — ' +
          'если почистить данные, они пропадут.';
      }

      const button = document.createElement('button');
      button.className = 'btn-ghost btn-sm';
      button.textContent = '⬇ Скачать копию';
      button.addEventListener('click', exportRecipes);

      box.append(text, button);
      return;
    }

    if (lastExportAt) {
      box.className = 'backup-notice ok';
      const date = new Date(lastExportAt).toLocaleDateString('ru-RU');
      box.textContent = `Копия от ${date} — шаблоны сохранены в файл.`;
    }
  }

  function renderRecipesList() {
    const box = $('#recipesList');
    box.innerHTML = '';

    renderBackupNotice();

    if (!recipes.length) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'Шаблонов пока нет. Нажмите «Новый шаблон», чтобы собрать первый готовый цвет.';
      box.appendChild(note);
      return;
    }

    recipes.forEach((recipe) => {
      const row = document.createElement('div');
      row.className = 'recipe-item';

      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = recipe.name;

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent =
        `База ${fmt(recipe.base)} ${recipe.unit} · ${recipe.mixes.length} ` +
        (recipe.mixes.length === 1 ? 'микс' : 'микса') + ' · ' +
        recipe.mixes.map((m) => `${shortenName(m.name)} ${fmt(m.amount)}`).join(', ');

      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'btn-group';

      const edit = document.createElement('button');
      edit.className = 'btn-left btn-sm';
      edit.textContent = 'Изменить';
      edit.addEventListener('click', () => startEdit(recipe));

      const del = document.createElement('button');
      del.className = 'btn-del btn-sm';
      del.style.padding = '5px 9px';
      del.textContent = 'Удалить';
      del.addEventListener('click', () => {
        if (!confirm(`Удалить шаблон «${recipe.name}»?`)) return;
        recipes = recipes.filter((r) => r.id !== recipe.id);
        persistRecipes();
        markDirty();
        renderRecipesList();
        toast('Шаблон удалён');
      });

      actions.append(edit, del);
      row.append(info, actions);
      box.appendChild(row);
    });
  }

  function startEdit(recipe) {
    editingId = recipe ? recipe.id : null;
    draftMixes = recipe ? JSON.parse(JSON.stringify(recipe.mixes)) : [];

    $('#recName').value = recipe ? recipe.name : '';
    $('#recBase').value = recipe ? fmt(recipe.base) : '100';
    $('#recUnit').value = recipe ? recipe.unit : 'г';
    $('#mixPicker').value = '';
    $('#mixPickerList').classList.remove('open');

    renderMixRows();
    updateMixSum();
    showEditor();
    $('#recName').focus();
  }

  function renderMixRows() {
    const box = $('#mixRows');
    box.innerHTML = '';

    if (!draftMixes.length) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'Миксов пока нет — найдите материал в поле ниже.';
      box.appendChild(note);
      return;
    }

    const unit = $('#recUnit').value;

    draftMixes.forEach((mix, index) => {
      const row = document.createElement('div');
      row.className = 'mix-row';

      const name = document.createElement('div');
      name.className = 'mix-name';
      name.textContent = `${mix.code} · ${shortenName(mix.name)}`;
      name.title = mix.name;

      const amount = document.createElement('input');
      amount.type = 'number';
      amount.min = '0';
      amount.step = '0.01';
      amount.placeholder = '0';
      amount.value = mix.amount ? fmt(mix.amount) : '';
      amount.addEventListener('input', () => {
        draftMixes[index].amount = parseFloat(amount.value) || 0;
        updateMixSum();
      });

      const unitLabel = document.createElement('span');
      unitLabel.className = 'unit';
      unitLabel.textContent = unit;

      const del = document.createElement('button');
      del.className = 'btn-del';
      del.textContent = '×';
      del.title = 'Убрать микс';
      del.addEventListener('click', () => {
        draftMixes.splice(index, 1);
        renderMixRows();
        updateMixSum();
      });

      row.append(name, amount, unitLabel, del);
      box.appendChild(row);
    });
  }

  function updateMixSum() {
    const el = $('#mixSum');
    const base = parseFloat($('#recBase').value) || 0;
    const unit = $('#recUnit').value;
    el.className = 'mix-sum';

    if (!draftMixes.length) {
      el.classList.add('warn');
      el.textContent = 'Добавьте хотя бы один микс.';
      return;
    }

    const sum = round2(draftMixes.reduce((acc, m) => acc + (Number(m.amount) || 0), 0));

    if (!(base > 0)) {
      el.classList.add('warn');
      el.textContent = 'Укажите базу состава больше нуля.';
      return;
    }

    const diff = round2(sum - base);

    if (Math.abs(diff) < 0.005) {
      el.classList.add('ok');
      el.textContent = `Сумма миксов: ${fmt(sum)} ${unit} — ровно база ✓`;
    } else {
      el.classList.add('warn');
      el.textContent =
        `Сумма миксов: ${fmt(sum)} ${unit}, база ${fmt(base)} ${unit} — ` +
        `разница ${fmt(diff)} ${unit}. Можно сохранить, но проверьте состав.`;
    }
  }

  function addDraftMix(item) {
    if (draftMixes.some((m) => m.code === item.code)) {
      toast('Этот микс уже есть в составе');
      return;
    }

    draftMixes.push({ code: item.code, name: item.name, amount: 0 });
    $('#mixPicker').value = '';
    $('#mixPickerList').classList.remove('open');
    renderMixRows();
    updateMixSum();

    const inputs = $('#mixRows').querySelectorAll('input[type=number]');
    if (inputs.length) {
      const last = inputs[inputs.length - 1];
      last.focus();
      last.select();
    }
  }

  function renderPicker() {
    const input = $('#mixPicker');
    const list = $('#mixPickerList');
    const query = input.value.trim().toLowerCase();

    list.innerHTML = '';

    if (!query) {
      list.classList.remove('open');
      return;
    }

    const words = query.split(/\s+/);
    const found = database
      .filter((item) => {
        const text = (item.code + ' ' + item.name).toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .slice(0, 10);

    if (!found.length) {
      list.classList.remove('open');
      return;
    }

    found.forEach((item) => {
      const row = document.createElement('div');
      const code = document.createElement('span');
      code.className = 'pk-code';
      code.textContent = item.code;
      row.append(code, document.createTextNode('  ' + item.name));
      row.addEventListener('click', () => addDraftMix(item));
      list.appendChild(row);
    });

    list.classList.add('open');
  }

  function saveRecipeFromEditor() {
    const name = $('#recName').value.trim();
    const base = parseFloat($('#recBase').value);
    const unit = $('#recUnit').value;

    if (!name) {
      toast('Введите название готового цвета');
      $('#recName').focus();
      return;
    }

    if (!(base > 0)) {
      toast('База состава должна быть больше нуля');
      $('#recBase').focus();
      return;
    }

    const mixes = draftMixes
      .map((m) => ({ code: m.code, name: m.name, amount: round2(Number(m.amount) || 0) }))
      .filter((m) => m.amount > 0);

    if (!mixes.length) {
      toast('Добавьте хотя бы один микс с количеством');
      return;
    }

    const payload = { name, base: round2(base), unit, mixes };
    const isNew = !editingId;

    if (editingId) {
      const index = recipes.findIndex((r) => r.id === editingId);
      if (index >= 0) recipes[index] = { ...recipes[index], ...payload };
    } else {
      recipes.push({ id: newId(), ...payload });
    }

    persistRecipes();
    markDirty();
    showRecipesList();
    renderSearchView();

    if (isNew && !lastExportAt) {
      toast(`«${name}» сохранён. Резервной копии нет — нажмите «Скачать копию».`);
    } else {
      toast(isNew ? `«${name}» сохранён` : 'Шаблон обновлён');
    }

    editingId = null;
  }

  /* ---- Экспорт / импорт базы шаблонов ---------------------------------- */

  function exportRecipes() {
    if (!recipes.length && !Object.keys(usage).length) {
      toast('Нечего выгружать: нет ни шаблонов, ни истории');
      return;
    }

    const payload = {
      app: 'paint-app',
      kind: 'recipes',
      version: 2,
      exportedAt: new Date().toISOString(),
      recipes,
      // Вместе с шаблонами переносим историю «часто используемых»,
      // чтобы на новом устройстве список не пришлось набирать заново.
      usage
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gotovye-kraski-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    backupDirty = 0;
    lastExportAt = Date.now();
    store.set(LS_DIRTY, backupDirty);
    store.set(LS_EXPORTED, lastExportAt);
    renderBackupNotice();

    toast(`Выгружено шаблонов: ${recipes.length}`);
  }

  function importRecipes(file) {
    const reader = new FileReader();

    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        toast('Файл не читается: это не JSON');
        return;
      }

      const incoming = Array.isArray(parsed) ? parsed : parsed.recipes;
      if (!Array.isArray(incoming)) {
        toast('В файле не найден список шаблонов');
        return;
      }

      let added = 0;
      let skipped = 0;

      incoming.forEach((raw) => {
        if (!raw || !raw.name || !Array.isArray(raw.mixes) || !(raw.base > 0)) {
          skipped++;
          return;
        }

        const sameName = recipes.some((r) => r.name.toLowerCase() === String(raw.name).toLowerCase());
        if (sameName) {
          skipped++;
          return;
        }

        recipes.push({
          id: raw.id && !recipes.some((r) => r.id === raw.id) ? raw.id : newId(),
          name: String(raw.name),
          base: round2(raw.base),
          unit: raw.unit || 'г',
          mixes: raw.mixes.map((m) => ({
            code: String(m.code || '—'),
            name: String(m.name || ''),
            amount: round2(Number(m.amount) || 0)
          }))
        });
        added++;
      });

      persistRecipes();
      renderRecipesList();

      // История «часто используемых» приезжает вместе с файлом
      let usageMerged = 0;

      if (parsed && typeof parsed === 'object' && parsed.usage && typeof parsed.usage === 'object') {
        Object.entries(parsed.usage).forEach(([code, info]) => {
          if (!info || !(info.n > 0)) return;

          const prev = usage[code];

          if (!prev) {
            usage[code] = {
              n: info.n,
              table: info.table === 'materials' ? 'materials' : 'paint',
              name: String(info.name || '')
            };
            usageMerged++;
          } else if (info.n > prev.n) {
            prev.n = info.n;
            if (info.name) prev.name = String(info.name);
          }
        });

        if (usageMerged) store.set(LS_USAGE, usage);
      }

      renderSearchView();

      let message = `Добавлено шаблонов: ${added}, пропущено: ${skipped} (уже есть или битые).`;
      if (usageMerged) message += ` Частых материалов: +${usageMerged}.`;
      toast(message);
    };

    reader.onerror = () => toast('Не удалось прочитать файл');
    reader.readAsText(file);
  }

  /* ----------------------------------------------------------------------
     7. Печать / PDF
     ---------------------------------------------------------------------- */

  function preparePrint() {
    const order = $('#orderNum').value.trim();
    const car = $('#carModel').value.trim();
    const vin = $('#vin').value.trim();
    const master = $('#master').value.trim();

    if (!master) {
      alert('Пожалуйста, введите имя маляра перед формированием PDF.');
      $('#master').focus();
      return;
    }

    $('#print-order').innerHTML = order ? `<strong>Заказ-наряд №</strong> ${escapeHtml(order)}` : '';

    let carLine = car ? `<strong>Автомобиль:</strong> ${escapeHtml(car)}` : '';
    if (vin) {
      carLine += (carLine ? ' | ' : '') + `<strong>VIN/Номер:</strong> ${escapeHtml(vin)}`;
    }
    $('#print-car').innerHTML = carLine;

    $('#print-master').innerHTML = `<strong>Маляр:</strong> ${escapeHtml(master)}`;
    $('#print-date').textContent = 'Дата: ' + new Date().toLocaleDateString('ru-RU');

    window.print();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ----------------------------------------------------------------------
     Вкладки (мобильные)
     ---------------------------------------------------------------------- */

  function switchTab(tab) {
    $('#panelSearch').classList.toggle('active', tab === 'search');
    $('#panelForm').classList.toggle('active', tab === 'form');
    $('#tabSearch').classList.toggle('active', tab === 'search');
    $('#tabForm').classList.toggle('active', tab === 'form');
  }

  /* ----------------------------------------------------------------------
     Запуск
     ---------------------------------------------------------------------- */

  function bindEvents() {
    $('#search').addEventListener('input', renderSearchView);

    $$('.mode-btn').forEach((button) => {
      button.addEventListener('click', () => setSearchMode(button.dataset.mode));
    });

    $('#clearSearchToggle').addEventListener('change', (e) => {
      store.set(LS_TOGGLE, e.target.checked);
    });

    $('#tabSearch').addEventListener('click', () => switchTab('search'));
    $('#tabForm').addEventListener('click', () => switchTab('form'));

    // Ручное добавление
    $('#btnManualPaint').addEventListener('click', () => addManual('paint'));
    $('#btnManualMaterials').addEventListener('click', () => addManual('materials'));

    // Шапка бланка
    ['orderNum', 'carModel', 'vin', 'master'].forEach((id) => {
      $('#' + id).addEventListener('input', saveForm);
    });

    $('#btnPdf').addEventListener('click', preparePrint);
    $('#btnClear').addEventListener('click', clearAll);

    // Шаблоны
    $('#btnOpenRecipes').addEventListener('click', openRecipesModal);
    $('#btnCloseRecipes').addEventListener('click', closeRecipesModal);
    $('#btnNewRecipe').addEventListener('click', () => startEdit(null));
    $('#btnCancelEdit').addEventListener('click', showRecipesList);
    $('#btnSaveRecipe').addEventListener('click', saveRecipeFromEditor);
    $('#btnExport').addEventListener('click', exportRecipes);
    $('#btnImport').addEventListener('click', () => $('#fileImport').click());

    $('#fileImport').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importRecipes(file);
      e.target.value = '';
    });

    $('#mixPicker').addEventListener('input', renderPicker);
    $('#mixPicker').addEventListener('focus', () => { if ($('#mixPicker').value.trim()) renderPicker(); });

    $('#recBase').addEventListener('input', updateMixSum);
    $('#recUnit').addEventListener('change', () => {
      renderMixRows();
      updateMixSum();
    });

    // Клик вне выпадающего списка миксов — закрыть его
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.picker')) $('#mixPickerList').classList.remove('open');
    });

    // Закрытие окна шаблонов по Esc
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#recipesModal').classList.contains('open')) closeRecipesModal();
    });
  }

  function addManual(table) {
    const codeInput = $('#manualCode');
    const nameInput = $('#manualName');
    const name = nameInput.value.trim();

    if (!name) {
      alert('Введите наименование!');
      return;
    }

    const code = codeInput.value.trim() || '—';
    addToReport(code, name, table, 1);
    afterAdd();
    codeInput.value = '';
    nameInput.value = '';
  }

  function init() {
    window.addEventListener('error', (event) => {
      const box = $('#error-log');
      box.style.display = 'block';
      box.textContent = 'ОШИБКА: ' + event.message + ' (строка ' + event.lineno + ')';
    });

    loadRecipes();
    usage = store.get(LS_USAGE, {}) || {};
    searchMode = store.get(LS_MODE, 'materials') === 'recipes' ? 'recipes' : 'materials';
    backupDirty = store.get(LS_DIRTY, 0) || 0;
    lastExportAt = store.get(LS_EXPORTED, 0) || 0;

    const toggle = store.get(LS_TOGGLE, true);
    $('#clearSearchToggle').checked = toggle !== false;

    loadForm();
    renderChips();
    applyModeUi();
    renderSearchView();
    bindEvents();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
