'use strict';

/*
 * Черновик нового заказа: пока заполняешь, всё сохраняется само.
 *
 *   node tools/patch-order-draft.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, text) => fs.writeFileSync(file, text);

let changed = 0;

/* ---------- 1. index.html: полоска черновика ---------- */

let html = read(path.join(root, 'server', 'public', 'index.html'));

if (!html.includes('id="draftBar"')) {
  const anchor = '      <h1 class="page-title">Новый заказ</h1>';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл заголовок нового заказа');
    process.exit(1);
  }

  const bar = [
    '      <h1 class="page-title">Новый заказ</h1>',
    '',
    '      <div class="draft-bar hidden" id="draftBar">',
    '        <span class="draft-text" id="draftText">Черновик сохраняется автоматически</span>',
    '        <button type="button" class="btn btn-outline btn-sm" id="btnDraftClear">Очистить черновик</button>',
    '      </div>'
  ].join('\n');

  html = html.replace(anchor, bar);
  changed++;
  console.log('index.html: полоска черновика');
}

write(path.join(root, 'server', 'public', 'index.html'), html);

/* ---------- 2. app.js ---------- */

let app = read(path.join(root, 'server', 'public', 'app.js'));

const block = [
  '  /* ------------------------------------------------------------------------',
  '     Черновик нового заказа: сохраняется сам, чтобы не терять заполненное',
  '     ------------------------------------------------------------------------ */',
  '',
  "  const DRAFT_FIELDS = ['carPlate', 'carVin', 'carMake', 'carModel', 'carColor',",
  "    'ownerName', 'ownerPhone', 'masterSelect', 'bodyworkerSelect', 'plannedDate', 'orderComment'];",
  '',
  '  function draftKey() {',
  "    return 'paintShopNewOrderDraft:' + ((state.user && state.user.id) || 'guest');",
  '  }',
  '',
  '  function readNewOrderDraft() {',
  '    try {',
  '      const raw = localStorage.getItem(draftKey());',
  '      return raw ? JSON.parse(raw) : null;',
  '    } catch (error) {',
  '      return null;',
  '    }',
  '  }',
  '',
  '  function draftHasContent(draft) {',
  '    if (!draft) return false;',
  '    if (Array.isArray(draft.works) && draft.works.length) return true;',
  '',
  '    return Object.values(draft.fields || {}).some((value) => String(value || \'\').trim() !== \'\');',
  '  }',
  '',
  '  /** Пишем черновик при каждом изменении полей. */',
  '  function saveNewOrderDraft() {',
  "    const form = $('#newOrderForm');",
  '    if (!form) return;',
  '',
  '    const draft = { at: new Date().toISOString(), fields: {}, works: state.newWorks };',
  '',
  '    DRAFT_FIELDS.forEach((id) => {',
  "      const field = $('#' + id);",
  '      if (field) draft.fields[id] = field.value;',
  '    });',
  '',
  '    try {',
  '      if (draftHasContent(draft)) {',
  '        localStorage.setItem(draftKey(), JSON.stringify(draft));',
  '      } else {',
  '        localStorage.removeItem(draftKey());',
  '      }',
  '    } catch (error) {',
  '      /* место в браузере могло кончиться — не ломаем форму */',
  '    }',
  '',
  '    paintDraftBar(draft);',
  '  }',
  '',
  '  let draftTimer = null;',
  '',
  '  function scheduleDraftSave() {',
  '    clearTimeout(draftTimer);',
  '    draftTimer = setTimeout(saveNewOrderDraft, 400);',
  '  }',
  '',
  '  function paintDraftBar(draft) {',
  "    const bar = $('#draftBar');",
  "    const text = $('#draftText');",
  '    if (!bar) return;',
  '',
  '    if (!draftHasContent(draft)) {',
  "      bar.classList.add('hidden');",
  '      return;',
  '    }',
  '',
  "    bar.classList.remove('hidden');",
  '',
  '    if (text) {',
  "      const at = draft.at ? new Date(draft.at) : new Date();",
  "      const time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });",
  "      text.textContent = 'Черновик сохранён в ' + time + ' — можно уйти и вернуться';",
  '    }',
  '  }',
  '',
  '  function clearNewOrderDraft() {',
  '    try {',
  '      localStorage.removeItem(draftKey());',
  '    } catch (error) {',
  '      /* ничего */',
  '    }',
  '',
  "    const bar = $('#draftBar');",
  "    if (bar) bar.classList.add('hidden');",
  '  }',
  '',
  '  /** Возвращаем заполненное, когда снова открыли новый заказ. */',
  '  function restoreNewOrderDraft() {',
  '    saveNewOrderDraft();',
  '',
  '    const draft = readNewOrderDraft();',
  '',
  '    if (!draftHasContent(draft)) {',
  "      const bar = $('#draftBar');",
  "      if (bar) bar.classList.add('hidden');",
  '      return false;',
  '    }',
  '',
  '    DRAFT_FIELDS.forEach((id) => {',
  "      const field = $('#' + id);",
  '      if (field && draft.fields && draft.fields[id] != null) field.value = draft.fields[id];',
  '    });',
  '',
  '    state.newWorks = Array.isArray(draft.works) ? draft.works : [];',
  '    renderNewWorks();',
  '    paintDraftBar(draft);',
  '',
  '    return true;',
  '  }',
  '',
  '  function resetNewOrder() {'
].join('\n');

if (!app.includes('DRAFT_FIELDS')) {
  const anchor = '  function resetNewOrder() {';

  if (!app.includes(anchor)) {
    console.error('app.js: не нашёл resetNewOrder');
    process.exit(1);
  }

  app = app.replace(anchor, () => block);
  changed++;
  console.log('app.js: черновик добавлен');
}

/* восстановление при открытии раздела */
if (!app.includes('restoreNewOrderDraft();')) {
  app = app.replace(
    "    $('#carPlate').focus();\n  }",
    "    // Если есть недозаполненный заказ — возвращаем его\n    restoreNewOrderDraft();\n\n    $('#carPlate').focus();\n  }"
  );
  changed++;
  console.log('app.js: черновик восстанавливается');
}

/* сохранение при вводе */
if (!app.includes("$('#newOrderForm').addEventListener('input'")) {
  app = app.replace(
    "    $('#newOrderForm').addEventListener('submit', submitNewOrder);",
    "    $('#newOrderForm').addEventListener('submit', submitNewOrder);\n\n    // Черновик: сохраняем на каждый ввод и при уходе со страницы\n    $('#newOrderForm').addEventListener('input', scheduleDraftSave);\n    $('#newOrderForm').addEventListener('change', scheduleDraftSave);\n    window.addEventListener('beforeunload', saveNewOrderDraft);\n\n    if ($('#btnDraftClear')) {\n      $('#btnDraftClear').addEventListener('click', () => {\n        clearNewOrderDraft();\n        resetNewOrder();\n        toast('Черновик очищен');\n      });\n    }"
  );
  changed++;
  console.log('app.js: автосохранение и кнопка очистки');
}

/* после создания заказа черновик больше не нужен */
if (!app.includes('clearNewOrderDraft();\n      showView')) {
  app = app.replace(
    "      state.order = data.order;\n      showView('order');",
    "      clearNewOrderDraft();\n\n      state.order = data.order;\n      showView('order');"
  );
  changed++;
  console.log('app.js: черновик стирается после создания');
}

/* отмена */
if (!app.includes("$('#btnCancelNew').addEventListener('click', () => {\n      clearNewOrderDraft();")) {
  app = app.replace(
    "    $('#btnCancelNew').addEventListener('click', () => showView('orders'));",
    "    $('#btnCancelNew').addEventListener('click', () => {\n      clearNewOrderDraft();\n      showView('orders');\n    });"
  );
  changed++;
  console.log('app.js: отмена стирает черновик');
}

write(path.join(root, 'server', 'public', 'app.js'), app);

/* ---------- 3. стили ---------- */

const cssFile = path.join(root, 'server', 'public', 'extra.css');
let css = read(cssFile);

if (!css.includes('.draft-bar')) {
  css += `

/* ---------- Черновик нового заказа ---------------------------------------- */

.draft-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(91, 155, 255, .45);
  border-radius: 10px;
  background: rgba(91, 155, 255, .10);
  font-size: 13px;
}

.draft-bar .draft-text { color: var(--ink-soft); }
.draft-bar .btn { margin-left: auto; }
`;
  write(cssFile, css);
  changed++;
  console.log('extra.css: стиль полоски черновика');
}

console.log('изменений:', changed);
