'use strict';

/*
 * Склад: колонка «минимум», приход, история движений и карточка «пора заказать».
 *
 *   node tools/patch-stock-ui.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let src = fs.readFileSync(file, 'utf8');
let changed = 0;

/* 1. Новая таблица склада + обработчики */
const oldRender = src.match(/  function renderWarehouse\(\) \{[\s\S]*?\r?\n  \}\r?\n/);

if (!oldRender) {
  console.error('не нашёл renderWarehouse');
  process.exit(1);
}

const newRender = `function renderWarehouse() {
    const host = $('#warehouseList');
    if (!host) return;

    const lowOnly = $('#stockLowOnly') && $('#stockLowOnly').checked;
    const list = lowOnly ? state.stock.filter((item) => item.low) : state.stock;

    if (!list.length) {
      host.innerHTML = '<div class="empty-line">' + (lowOnly ? 'Всё в норме — ничего не заканчивается' : 'Ничего не найдено') + '</div>';
      return;
    }

    const staff = canStore();

    host.innerHTML = \`
      <table class="grid">
        <thead>
          <tr>
            <th>Код</th>
            <th>Наименование</th>
            <th class="num">Остаток</th>
            <th class="num">Минимум</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          \${list.map((item) => \`
            <tr class="\${item.low ? 'stock-row-low' : ''}">
              <td class="code-cell" data-label="Код">\${esc(item.code)}</td>
              <td data-label="Наименование">
                \${esc(item.name)} \${tdsButton(item)}
                \${item.low ? '<span class="stock-badge empty">пора заказать</span>' : ''}
              </td>
              <td class="num" data-label="Остаток">
                \${staff
                  ? \`<span class="stock-inline">
                       <input type="number" min="0" step="0.01" value="\${item.left}"
                              data-stock-code="\${esc(item.code)}" class="stock-input">
                       <span class="unit">\${esc(item.unit)}</span>
                     </span>\`
                  : \`<span class="stock-badge\${item.left <= 0 ? ' empty' : ''}">\${qty(item.left)} \${esc(item.unit)}</span>\`}
              </td>
              <td class="num" data-label="Минимум">
                \${staff
                  ? \`<input type="number" min="0" step="0.01" value="\${item.min_stock || 0}"
                            data-stock-min="\${esc(item.code)}" class="stock-input stock-min-input">\`
                  : (item.min_stock ? \`<span class="mono">\${qty(item.min_stock)} \${esc(item.unit)}</span>\` : '<span class="muted">—</span>')}
              </td>
              <td class="stock-actions">
                \${staff ? \`<button class="btn btn-outline btn-sm" data-stock-in="\${esc(item.code)}">Приход</button>\` : ''}
                <button class="btn btn-outline btn-sm" data-stock-history="\${esc(item.code)}">История</button>
              </td>
            </tr>\`).join('')}
        </tbody>
      </table>
    \`;

    host.querySelectorAll('[data-stock-code]').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await api('/api/stock/' + encodeURIComponent(input.dataset.stockCode), {
            method: 'PATCH',
            body: { left: Number(input.value) || 0 }
          });

          toast('Остаток обновлён');
          loadWarehouse();
        } catch (error) {
          toast(error.message);
        }
      });
    });

    host.querySelectorAll('[data-stock-min]').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await api('/api/stock/' + encodeURIComponent(input.dataset.stockMin) + '/min', {
            method: 'PATCH',
            body: { min: Number(input.value) || 0 }
          });

          toast('Минимум сохранён');
          loadWarehouse();
          loadLowStock();
        } catch (error) {
          toast(error.message);
        }
      });
    });

    host.querySelectorAll('[data-stock-in]').forEach((button) => {
      button.addEventListener('click', () => openIncoming(button.dataset.stockIn));
    });

    host.querySelectorAll('[data-stock-history]').forEach((button) => {
      button.addEventListener('click', () => openStockHistory(button.dataset.stockHistory));
    });
  }

  /* Приход товара */
  let incomingCode = null;

  function openIncoming(code) {
    const item = state.stock.find((row) => row.code === code);
    if (!item) return;

    incomingCode = code;

    const modal = $('#stockIncomingModal');
    if (!modal) return;

    $('#stockIncomingTitle').textContent = 'Приход: ' + item.name;
    $('#incomingQty').value = '';
    $('#incomingPrice').value = item.price ? item.price : '';
    $('#incomingNote').value = '';
    if ($('#incomingMessage')) $('#incomingMessage').textContent = '';

    modal.classList.remove('hidden');
    $('#incomingQty').focus();
  }

  async function saveIncoming() {
    if (!incomingCode) return;

    const qty = Number($('#incomingQty').value) || 0;
    const price = Number($('#incomingPrice').value) || 0;
    const note = $('#incomingNote').value.trim();

    if (!(qty > 0)) {
      if ($('#incomingMessage')) $('#incomingMessage').textContent = 'Укажите, сколько пришло';
      return;
    }

    const button = $('#btnSaveIncoming');
    if (button) { button.disabled = true; button.textContent = 'Записываю…'; }

    try {
      await api('/api/stock/incoming', { method: 'POST', body: { code: incomingCode, qty, price, note } });

      $('#stockIncomingModal').classList.add('hidden');
      toast('Приход записан: +' + qty);
      incomingCode = null;

      await loadWarehouse();
      await loadLowStock();
    } catch (error) {
      if ($('#incomingMessage')) $('#incomingMessage').textContent = error.message;
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Оприходовать'; }
    }
  }

  /* История движений */
  function moveLabel(kind) {
    if (kind === 'in') return 'Приход';
    if (kind === 'adjust') return 'Правка остатка';
    return 'Списание';
  }

  async function openStockHistory(code) {
    const modal = $('#stockHistoryModal');
    if (!modal) return;

    const item = state.stock.find((row) => row.code === code);
    $('#stockHistoryTitle').textContent = 'История: ' + (item ? item.name : code);
    $('#stockHistoryList').innerHTML = '<div class="spinner">Загрузка…</div>';
    modal.classList.remove('hidden');

    try {
      const data = await api('/api/stock/moves?code=' + encodeURIComponent(code));
      const moves = data.moves || [];

      if (!moves.length) {
        $('#stockHistoryList').innerHTML = '<div class="empty-line">Движений пока не было</div>';
        return;
      }

      $('#stockHistoryList').innerHTML = moves.map((move) => {
        const when = new Date(move.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
        const sign = move.qty > 0 ? '+' : '';
        const qtyText = move.kind === 'adjust' ? move.note : sign + qty(move.qty) + ' ' + esc(move.unit);

        return '<div class="move-row">' +
          '<span class="move-kind move-' + esc(move.kind) + '">' + esc(moveLabel(move.kind)) + '</span>' +
          '<span class="move-qty mono">' + esc(qtyText) + '</span>' +
          '<span class="move-meta muted">' + esc(when) + (move.user ? ' · ' + esc(move.user) : '') + '</span>' +
        '</div>';
      }).join('');
    } catch (error) {
      $('#stockHistoryList').innerHTML = '<div class="empty-line">' + esc(error.message) + '</div>';
    }
  }

  /* Что заканчивается */
  async function loadLowStock() {
    const card = $('#stockLowCard');
    const list = $('#stockLowList');
    if (!card || !list) return;

    try {
      const data = await api('/api/stock/low');
      const items = data.items || [];

      if (!items.length) {
        card.classList.add('hidden');
        list.innerHTML = '';
        return;
      }

      card.classList.remove('hidden');

      list.innerHTML = items.map((item) =>
        '<div class="low-row">' +
          '<span class="low-name">' + esc(item.name) + '</span>' +
          '<span class="low-qty mono">' + qty(item.left) + ' из ' + qty(item.min_stock) + ' ' + esc(item.unit) + '</span>' +
          (canStore() ? '<button class="btn btn-outline btn-sm" data-low-in="' + esc(item.code) + '">Приход</button>' : '') +
        '</div>'
      ).join('');

      list.querySelectorAll('[data-low-in]').forEach((button) => {
        button.addEventListener('click', () => openIncoming(button.dataset.lowIn));
      });
    } catch (error) {
      card.classList.add('hidden');
    }
  }
`;

src = src.replace(oldRender[0], newRender + (src.includes('\r\n') ? '\r\n' : '\n'));
changed++;
console.log('склад: таблица, приход, история, «пора заказать»');

/* 2. Загрузка склада подтягивает ещё и «что заканчивается» */
src = src.replace(
  `    } catch (error) {
      host.innerHTML = \`<div class="empty-line">\${esc(error.message)}</div>\`;
    }
  }

  async function renderWarehouse`,
  `    } catch (error) {
      host.innerHTML = \`<div class="empty-line">\${esc(error.message)}</div>\`;
    }
  }

  async function renderWarehouse`
);

fs.writeFileSync(file, src);
console.log('изменений:', changed);
