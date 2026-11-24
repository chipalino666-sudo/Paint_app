'use strict';

/*
 * Цифры на вкладках статусов: показывают, в какую именно вкладку попал заказ
 * после смены статуса.
 *
 *   node tools/patch-status-badges.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'server', 'public', 'app.js');
const cssFile = path.join(root, 'server', 'public', 'extra.css');

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* ---------- 1. Фишки с цифрами ---------- */

const startMarker = '  function renderStatusChips() {';
const endMarker = '  /** silent = true';

const start = app.indexOf(startMarker);
const end = app.indexOf(endMarker);

if (start < 0 || end < 0 || end < start) {
  console.error('app.js: не нашёл renderStatusChips');
  process.exit(1);
}

const block = [
  '  function renderStatusChips() {',
  "    const box = $('#statusChips');",
  '    if (!box) return;',
  '',
  '    const changes = state.statusChanges || {};',
  "    box.innerHTML = '';",
  '',
  '    FILTERS.forEach((filter) => {',
  '      const chip = document.createElement(\'button\');',
  "      chip.className = 'chip' + (state.orderFilter.status === filter.id ? ' active' : '');",
  '',
  "      const label = document.createElement('span');",
  '      label.textContent = filter.label;',
  '      chip.appendChild(label);',
  '',
  '      // Цифра подсказывает, в какую именно вкладку попали изменённые заказы',
  "      const count = filter.id === 'open'",
  '        ? (Number(changes.accepted) || 0) + (Number(changes.in_work) || 0) + (Number(changes.ready) || 0)',
  '        : Number(changes[filter.id]) || 0;',
  '',
  '      if (count > 0) {',
  "        const badge = document.createElement('span');",
  "        badge.className = 'chip-badge';",
  "        badge.textContent = count > 99 ? '99+' : String(count);",
  '        chip.appendChild(badge);',
  '      }',
  '',
  "      chip.addEventListener('click', () => {",
  '        state.orderFilter.status = filter.id;',
  '        renderStatusChips();',
  '        loadOrders();',
  '        markStatusSeen(filter.id);',
  '      });',
  '',
  '      box.appendChild(chip);',
  '    });',
  '  }',
  '',
  '  /** Открыли вкладку статуса — её изменения больше не «новые». */',
  '  async function markStatusSeen(status) {',
  '    const changes = state.statusChanges || {};',
  "    const affected = status === 'open'",
  "      ? ['accepted', 'in_work', 'ready']",
  '      : [status];',
  '',
  '    if (!affected.some((key) => Number(changes[key]) > 0)) return;',
  '',
  '    try {',
  '      for (const key of affected) {',
  '        if (Number(changes[key]) > 0) {',
  "          await api('/api/orders/status-seen', { method: 'POST', body: { status: key } });",
  '          delete changes[key];',
  '        }',
  '      }',
  '',
  '      state.statusChanges = changes;',
  '      renderStatusChips();',
  '    } catch (error) {',
  '      /* не критично */',
  '    }',
  '  }',
  '',
  ''
].join('\n');

app = app.slice(0, start) + block + app.slice(end);
changed++;
console.log('app.js: фишки статусов с цифрами');

/* ---------- 2. Сохраняем разбивку с сервера ---------- */

const badgeAnchor = '      setBadge(generalBadge, channels.general || 0);';

if (app.includes(badgeAnchor) && !app.includes('state.statusChanges = byStatus')) {
  app = app.replace(
    badgeAnchor,
    [
      badgeAnchor,
      '      setBadge(ordersBadge, ordersTotal);',
      '',
      '      // Разбивка по статусам: где именно новые изменения',
      '      const byStatus = data.by_status || {};',
      '      const before = JSON.stringify(state.statusChanges || {});',
      '',
      '      state.statusChanges = byStatus;',
      '',
      '      if (JSON.stringify(byStatus) !== before) renderStatusChips();'
    ].join('\n')
  );

  // убираем второй setBadge(ordersBadge...) ниже, если он остался дублем
  app = app.replace(
    '      if (JSON.stringify(byStatus) !== before) renderStatusChips();\n      setBadge(ordersBadge, ordersTotal);',
    '      if (JSON.stringify(byStatus) !== before) renderStatusChips();'
  );

  changed++;
  console.log('app.js: разбивка статусов сохраняется');
}

/* ---------- 3. Состояние ---------- */

if (!app.includes('statusChanges:')) {
  app = app.replace(
    '  const state = {',
    '  const state = {\n    statusChanges: {},'
  );

  changed++;
  console.log('app.js: состояние для статусов');
}

fs.writeFileSync(appFile, app);

/* ---------- 4. Стили и мобильные правки ---------- */

let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

if (!css.includes('.chip-badge')) {
  css += `

/* ---------- Цифры на вкладках статусов ------------------------------------ */

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.chip-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--red);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.chip.active .chip-badge {
  background: #fff;
  color: var(--blue);
}

/* На телефоне вкладки статусов переносятся, а не уезжают вбок */
@media (max-width: 600px) {
  .chips {
    flex-wrap: wrap;
    overflow-x: visible;
  }

  .chip {
    padding: 6px 11px;
    font-size: 12.5px;
  }

  html, body {
    overflow-x: hidden;
    max-width: 100%;
  }
}
`;

  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: цифры на вкладках и мобильная переноска');
}

console.log('изменений:', changed);
