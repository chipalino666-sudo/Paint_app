'use strict';

/* ==========================================================================
   Клиент: заказы, карточка заказа, списание материалов, отчёты, справочники.
   ========================================================================== */

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  /** Телефон или узкое окно — тот же порог, что в стилях. */
  const isMobile = () => window.innerWidth <= 780;

  const STATUS = {
    accepted: 'Принят',
    in_work: 'В работе',
    ready: 'Готов',
    closed: 'Закрыт',
    cancelled: 'Отменён',
    draft: 'Черновик'
  };

  const ROLE_DEFAULTS = {
    admin: 'администратор',
    manager: 'приёмщик',
    painter: 'маляр',
    bodyworker: 'кузовщик',
    store: 'склад',
    workstation: 'рабочее место'
  };

  /** Маляр и кузовщик — оба «master», различаются специальностью. */
  function roleLabel(user) {
    const labels = state.roleLabels || ROLE_DEFAULTS;

    if (user.is_workstation) return labels.workstation;
    if (user.role === 'master') {
      return user.specialty === 'bodyworker' ? labels.bodyworker : labels.painter;
    }

    return labels[user.role] || user.role;
  }

  const state = {
    user: null,
    view: 'orders',
    orders: [],
    order: null,
    works: [],
    recipes: [],
    users: [],
    orderFilter: { status: 'open', q: '' },
    editingRecipe: null,
    draftMixes: [],
    newWorks: [],
    workstation: false,
    idleMinutes: 10,
    roleLabels: null
  };

  // Переписка: общий канал и обсуждение текущего заказа
  const chat = {
    general: { channel: 'general', messages: [], lastId: 0 },
    order: { channel: null, messages: [], lastId: 0 }
  };

  /* ------------------------------------------------------------------------
     Утилиты
     ------------------------------------------------------------------------ */

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    const n = Number(value) || 0;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' \u20BD';
  }

  function qty(value) {
    const n = Number(value) || 0;
    let text = String(Math.round(n * 100) / 100);
    if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
    return text;
  }

  function dateText(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU');
  }

  let toastTimer = null;
  function toast(message) {
    const box = $('#toast');
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), 2600);
  }

  async function api(path, options = {}) {
    const { method = 'GET', body } = options;

    const response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });

    if (response.status === 401) {
      location.href = '/login.html';
      throw new Error('Нужно войти');
    }

    // 423 — кабинет мастера закрылся (бездействие или «Сменить мастера»)
    if (response.status === 423) {
      showPinScreen();
      throw new Error('Введите ПИН-код');
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(data.error || 'Ошибка запроса');

    return data;
  }

  const isManager = () => state.user && (state.user.role === 'admin' || state.user.role === 'manager');
  const isMaster = () => state.user && state.user.role === 'master';

  /* ------------------------------------------------------------------------
     Навигация
     ------------------------------------------------------------------------ */

  function showView(name) {
    state.view = name;

    $$('.view').forEach((view) => view.classList.add('hidden'));
    const target = document.getElementById('view-' + name);
    if (target) target.classList.remove('hidden');

    $$('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === name);
    });

    if (name === 'orders') loadOrders();
    if (name === 'chat') openGeneralChat();
    if (name === 'report') loadReport();
    if (name === 'refs') loadRefs();
    if (name === 'users') loadUsers();
    if (name === 'new') resetNewOrder();
  }

  /* ------------------------------------------------------------------------
     Список заказов
     ------------------------------------------------------------------------ */

  const FILTERS = [
    { id: 'open', label: 'Открытые' },
    { id: 'accepted', label: 'Приняты' },
    { id: 'in_work', label: 'В работе' },
    { id: 'ready', label: 'Готовы' },
    { id: 'closed', label: 'Закрыты' },
    { id: 'all', label: 'Все' }
  ];

  function renderStatusChips() {
    const box = $('#statusChips');
    box.innerHTML = '';

    FILTERS.forEach((filter) => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (state.orderFilter.status === filter.id ? ' active' : '');
      chip.textContent = filter.label;
      chip.addEventListener('click', () => {
        state.orderFilter.status = filter.id;
        renderStatusChips();
        loadOrders();
      });
      box.appendChild(chip);
    });
  }

  async function loadOrders() {
    const body = $('#ordersBody');
    body.innerHTML = '<tr><td colspan="6" class="spinner">Загрузка…</td></tr>';

    const params = new URLSearchParams();

    // «Открытые» = всё, что ещё не закрыто и не отменено
    if (state.orderFilter.status === 'open') params.set('status', 'accepted,in_work,ready');
    else if (state.orderFilter.status !== 'all') params.set('status', state.orderFilter.status);

    if (state.orderFilter.q) params.set('q', state.orderFilter.q);

    try {
      const data = await api('/api/orders?' + params.toString());
      state.orders = data.orders;
      renderOrders();
    } catch (error) {
      body.innerHTML = `<tr><td colspan="6" class="empty-line">${esc(error.message)}</td></tr>`;
    }
  }

  function renderOrders() {
    const body = $('#ordersBody');
    const empty = $('#ordersEmpty');
    empty.innerHTML = '';

    if (!state.orders.length) {
      body.innerHTML = '';
      empty.innerHTML = '<div class="empty-line" style="margin-top:14px">Заказов нет. ' +
        (isManager() ? 'Нажмите «Новый заказ», чтобы принять машину.' : 'Пока вам ничего не назначено.') +
        '</div>';
      return;
    }

    // На телефоне таблица из шести колонок не читается — показываем карточки
    if (isMobile()) {
      body.innerHTML = '';

      const list = document.createElement('div');
      list.className = 'order-cards';

      state.orders.forEach((order) => {
        const card = document.createElement('div');
        card.className = 'order-card';
        card.dataset.id = order.id;

        card.innerHTML = `
          <div class="oc-top">
            <span class="order-number">${esc(order.number)}</span>
            <span class="status-pill status-${esc(order.status)}">${esc(STATUS[order.status] || order.status)}</span>
          </div>
          <div class="oc-car">${esc(order.plate)}<span class="muted"> ${esc([order.make, order.model].filter(Boolean).join(' '))}</span></div>
          <div class="oc-master">${esc(order.master_name || 'маляр не назначен')}${order.bodyworker_name
            ? `<span class="muted"> · кузовщик: ${esc(order.bodyworker_name)}</span>` : ''}</div>
          <div class="oc-bottom">
            <span class="muted">${dateText(order.created_at)}</span>
            <span class="mono">${money(order.total)}</span>
          </div>
        `;

        card.addEventListener('click', () => openOrder(order.id));
        list.appendChild(card);
      });

      empty.appendChild(list);
      return;
    }

    body.innerHTML = state.orders.map((order) => `
      <tr data-id="${order.id}">
        <td><span class="order-number">${esc(order.number)}</span></td>
        <td>
          <div>${esc(order.plate)}</div>
          <div class="muted">${esc([order.make, order.model].filter(Boolean).join(' '))}</div>
        </td>
        <td>${esc(order.master_name || '—')}${order.bodyworker_name
          ? `<div class="muted">кузовщик: ${esc(order.bodyworker_name)}</div>` : ''}</td>
        <td><span class="status-pill status-${esc(order.status)}">${esc(STATUS[order.status] || order.status)}</span></td>
        <td class="muted">${dateText(order.created_at)}</td>
        <td class="num mono">${money(order.total)}</td>
      </tr>
    `).join('');

    [...body.rows].forEach((row) => {
      row.addEventListener('click', () => openOrder(row.dataset.id));
    });
  }

  /* ------------------------------------------------------------------------
     Карточка заказа
     ------------------------------------------------------------------------ */

  async function openOrder(id) {
    try {
      const data = await api('/api/orders/' + id);
      state.order = data.order;
      showView('order');
      renderOrder();
    } catch (error) {
      toast(error.message);
    }
  }

  function orderActions(order) {
    const buttons = [];

    if (isManager()) {
      if (order.status === 'accepted') {
        buttons.push({ status: 'in_work', label: 'В работу', cls: 'btn-primary' });
      }
      if (order.status === 'in_work') {
        buttons.push({ status: 'ready', label: 'Готово', cls: 'btn-success' });
      }
      if (order.status === 'ready') {
        buttons.push({ status: 'closed', label: 'Закрыть', cls: 'btn-primary' });
        buttons.push({ status: 'in_work', label: 'Вернуть в работу', cls: 'btn-outline' });
      }
      if (['accepted', 'in_work', 'ready'].includes(order.status)) {
        buttons.push({ status: 'cancelled', label: 'Отменить', cls: 'btn-danger-outline' });
      }
    } else if (isMaster() && Number(order.master_id) === Number(state.user.id)) {
      if (order.status === 'in_work') {
        buttons.push({ status: 'ready', label: 'Готово', cls: 'btn-success' });
      }
    }

    return buttons;
  }

  function renderOrder() {
    const order = state.order;
    const host = $('#orderBody');
    if (!order) return;

    // Списывать материал можно, пока заказ не сдан: после «Готово» — только через возврат в работу
    const canEdit = order.status === 'accepted' || order.status === 'in_work';
    const canEditPrices = isManager() && canEdit;

    // Код краски — зона мастера: он знает, чем красил. Приёмщик тоже может поправить.
    const isOwnOrder = Number(order.master_id) === Number(state.user.id);
    const canEditCode = canEdit && (isManager() || (isMaster() && isOwnOrder));

    const actionButtons = orderActions(order).map((button) =>
      `<button class="btn ${button.cls}" data-status="${button.status}">${button.label}</button>`).join('');

    const worksRows = order.works.length
      ? order.works.map((row) => `
          <tr data-wid="${row.id}">
            <td data-label="Работа">${esc(row.name)}</td>
            <td class="num" data-label="Кол-во">${canEditPrices
              ? `<input type="number" min="0" step="0.1" value="${qty(row.qty)}" data-work-qty="${row.id}" style="width:70px">`
              : qty(row.qty)}</td>
            <td class="num" data-label="Цена">${canEditPrices
              ? `<input type="number" min="0" step="0.01" value="${row.price}" data-work-price-edit="${row.id}" style="width:100px">`
              : `<span class="mono">${money(row.price)}</span>`}</td>
            <td class="num mono" data-label="Сумма">${money(row.sum)}</td>
            <td class="num" data-label="">${canEditPrices ? `<button class="row-del" data-del-work="${row.id}" title="Убрать">×</button>` : ''}</td>
          </tr>`).join('')
      : '<tr><td colspan="5" class="empty-line">Работы не добавлены</td></tr>';

    host.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <h2>Заказ № ${esc(order.number)}
              <span class="status-pill status-${esc(order.status)}">${esc(STATUS[order.status] || order.status)}</span>
            </h2>
            <div class="card-title-sub">
              ${esc(order.plate)} · ${esc([order.make, order.model].filter(Boolean).join(' ') || 'марка не указана')}
              ${order.color ? ' · ' + esc(order.color) : ''}
            </div>
          </div>
          <div class="actions-row">
            ${isManager() ? '<button class="btn btn-outline" id="btnEditOrder">Изменить</button>' : ''}
            ${actionButtons}
            <button class="btn btn-outline" id="btnPrint">Печать</button>
            <button class="btn btn-outline" id="btnBack">← К списку</button>
          </div>
        </div>

        <div class="kv">
          <div><div class="k">Маляр</div><div class="v">${esc(order.master_name || 'не назначен')}</div></div>
          <div><div class="k">Кузовщик</div><div class="v">${esc(order.bodyworker_name || '—')}</div></div>
          <div><div class="k">VIN</div><div class="v">${esc(order.vin || '—')}</div></div>
          <div><div class="k">Цвет</div><div class="v">${esc(order.color || '—')}</div></div>
          <div>
            <div class="k">Код краски</div>
            <div class="v">${canEditCode
              ? `<input type="text" id="colorCodeInput" value="${esc(order.color_code || '')}" placeholder="укажет мастер"
                        style="width:100%;max-width:150px;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:13px">`
              : esc(order.color_code || '—')}</div>
          </div>
          <div><div class="k">Владелец</div><div class="v">${esc(order.owner_name || '—')}</div></div>
          <div><div class="k">Телефон</div><div class="v">${esc(order.owner_phone || '—')}</div></div>
          <div><div class="k">Принят</div><div class="v">${dateText(order.created_at)}</div></div>
          <div><div class="k">Плановая дата</div><div class="v">${order.planned_date ? esc(order.planned_date) : '—'}</div></div>
          <div><div class="k">Приёмщик</div><div class="v">${esc(order.created_by_name || '—')}</div></div>
        </div>

        ${order.comment ? `<div class="muted" style="margin-top:10px">${esc(order.comment)}</div>` : ''}
      </div>

      <div class="card">
        <div class="section-head">
          <h3>Работы</h3>
          ${canEditPrices ? '<button class="btn btn-outline" id="btnAddWorkToOrder">+ Добавить работу</button>' : ''}
        </div>

        <table class="lines">
          <thead>
            <tr><th>Работа</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th><th></th></tr>
          </thead>
          <tbody>${worksRows}</tbody>
        </table>

        <div id="addWorkToOrderBox"></div>
      </div>

      <div class="card">
        <div class="section-head"><h3>Списание материала</h3></div>

        <div class="section-title">Автоэмаль</div>
        <table class="lines">
          <thead><tr><th>Код</th><th>Наименование</th><th class="num">Кол-во</th><th class="num">Сумма</th><th></th></tr></thead>
          <tbody>${materialRows(order.materials.filter((m) => m.kind === 'paint'), canEdit)}</tbody>
        </table>

        <div class="section-title" style="margin-top:14px">Материалы</div>
        <table class="lines">
          <thead><tr><th>Код</th><th>Наименование</th><th class="num">Кол-во</th><th class="num">Сумма</th><th></th></tr></thead>
          <tbody>${materialRows(order.materials.filter((m) => m.kind === 'material'), canEdit)}</tbody>
        </table>

        ${canEdit ? '<div class="add-box" id="addMaterialBox"></div>' : ''}

        <div class="totals">
          <div>
            <div class="t-k">Работы</div>
            <div class="t-v">${money(order.works_sum)}</div>
          </div>
          <div>
            <div class="t-k">Материалы</div>
            <div class="t-v">${money(order.materials_sum)}</div>
          </div>
          <div>
            <div class="t-k">Итого</div>
            <div class="t-v grand">${money(order.total)}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>История изменений</h2>
          <span class="muted">кто, когда и что менял</span>
        </div>
        <div id="orderHistory"><div class="spinner">Загрузка…</div></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Обсуждение заказа</h2>
          <span class="muted">видно всем, кто работает с цехом</span>
        </div>

        <div class="chat-messages chat-messages--inline" id="orderChatMessages"></div>

        <form class="chat-form" id="orderChatForm" style="border:none;padding:10px 0 0">
          <input type="text" id="orderChatInput" placeholder="Написать по этому заказу…" autocomplete="off" maxlength="2000">
          <button type="submit" class="btn btn-primary">Отправить</button>
        </form>
      </div>
    `;

    bindOrderEvents(order, canEdit, canEditPrices);
    loadHistory(order.id);
    openOrderChat(order);
  }

  function materialRows(rows, canEdit) {
    if (!rows.length) {
      return '<tr><td colspan="5" class="empty-line">Пусто</td></tr>';
    }

    return rows.map((row) => `
      <tr data-mid="${row.id}">
        <td class="code-cell" data-label="Код">${esc(row.code)}</td>
        <td data-label="Наименование">${esc(row.name)}</td>
        <td class="num" data-label="Кол-во">
          ${canEdit
            ? `<input type="number" min="0.01" step="0.01" value="${qty(row.qty)}" data-qty="${row.id}"> ${esc(row.unit)}`
            : `${qty(row.qty)} ${esc(row.unit)}`}
        </td>
        <td class="num mono" data-label="Сумма">${money(row.sum)}</td>
        <td class="num" data-label="">${canEdit ? `<button class="row-del" data-del-material="${row.id}" title="Убрать">×</button>` : ''}</td>
      </tr>
    `).join('');
  }

  function bindOrderEvents(order, canEdit, canEditPrices) {
    $('#btnBack').addEventListener('click', () => showView('orders'));
    $('#btnPrint').addEventListener('click', () => window.open('/print.html?id=' + order.id, '_blank'));

    $$('[data-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        const status = button.dataset.status;

        if (status === 'cancelled' && !confirm('Отменить заказ?')) return;

        try {
          const data = await api('/api/orders/' + order.id, {
            method: 'PATCH',
            body: { status }
          });
          state.order = data.order;
          renderOrder();
          toast('Статус: ' + (STATUS[state.order.status] || state.order.status));
        } catch (error) {
          toast(error.message);
        }
      });
    });

    $$('[data-qty]').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          const data = await api(`/api/orders/${order.id}/materials/${input.dataset.qty}`, {
            method: 'PATCH',
            body: { qty: Number(input.value) }
          });
          state.order = data.order;
          renderOrder();
        } catch (error) {
          toast(error.message);
        }
      });
    });

    $$('[data-del-material]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const data = await api(`/api/orders/${order.id}/materials/${button.dataset.delMaterial}`, { method: 'DELETE' });
          state.order = data.order;
          renderOrder();
        } catch (error) {
          toast(error.message);
        }
      });
    });

    $$('[data-del-work]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const data = await api(`/api/orders/${order.id}/works/${button.dataset.delWork}`, { method: 'DELETE' });
          state.order = data.order;
          renderOrder();
        } catch (error) {
          toast(error.message);
        }
      });
    });

    if (canEditPrices && $('#btnAddWorkToOrder')) {
      $('#btnAddWorkToOrder').addEventListener('click', () => showWorkPicker(order));
    }

    if ($('#btnEditOrder')) {
      $('#btnEditOrder').addEventListener('click', () => openEditOrder());
    }

    // Код краски мастер вписывает сам — сразу сохраняется в карточку машины
    if ($('#colorCodeInput')) {
      const input = $('#colorCodeInput');

      const saveCode = async () => {
        try {
          const data = await api('/api/orders/' + order.id, {
            method: 'PATCH',
            body: { car: { color_code: input.value } }
          });
          state.order = data.order;
          renderOrder();
          toast('Код краски сохранён');
        } catch (error) {
          toast(error.message);
        }
      };

      input.addEventListener('change', saveCode);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
    }

    // Правка количества и цены работы прямо в строке
    $$('[data-work-qty], [data-work-price-edit]').forEach((input) => {
      input.addEventListener('change', async () => {
        const isQty = Boolean(input.dataset.workQty);
        const workRowId = isQty ? input.dataset.workQty : input.dataset.workPriceEdit;

        try {
          const data = await api(`/api/orders/${order.id}/works/${workRowId}`, {
            method: 'PATCH',
            body: isQty ? { qty: Number(input.value) } : { price: Number(input.value) }
          });
          state.order = data.order;
          renderOrder();
        } catch (error) {
          toast(error.message);
        }
      });
    });

    const orderChatForm = $('#orderChatForm');
    if (orderChatForm) {
      orderChatForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const input = $('#orderChatInput');
        const text = input.value;
        input.value = '';

        try {
          await sendChat('order', text);
        } catch (error) {
          toast(error.message);
        }
      });
    }

    if (canEdit) mountAddMaterial(order);
  }

  /* ---- История изменений -------------------------------------------------- */

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const day = d.toLocaleDateString('ru-RU');
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `${day} ${time}`;
  }

  async function loadHistory(orderId) {
    const host = $('#orderHistory');
    if (!host) return;

    try {
      const data = await api(`/api/orders/${orderId}/history`);

      if (!data.history.length) {
        host.innerHTML = '<div class="empty-line">Пока ничего не меняли</div>';
        return;
      }

      host.innerHTML = `<ul class="history">${data.history.map((row) => `
        <li>
          <div class="muted">${formatDateTime(row.at)} · ${esc(row.user)}</div>
          <div>${esc(row.text)}</div>
        </li>`).join('')}</ul>`;
    } catch (error) {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

  /* ---- Внутренний чат ----------------------------------------------------- */

  function chatContainer(key) {
    return key === 'general' ? $('#chatMessages') : $('#orderChatMessages');
  }

  function renderChat(key) {
    const host = chatContainer(key);
    if (!host) return;

    const box = chat[key];

    if (!box.messages.length) {
      host.innerHTML = '<div class="chat-empty">Пока тихо. Напишите первым — сообщение останется в истории.</div>';
      return;
    }

    host.innerHTML = box.messages.map((message) => {
      const own = Number(message.user_id) === Number(state.user.id);

      return `<div class="msg${own ? ' own' : ''}">
        <div class="msg-head">
          <span class="msg-author">${esc(message.user_name)}</span>
          <span class="msg-time">${formatDateTime(message.created_at)}</span>
        </div>
        <div class="msg-body">${esc(message.body)}</div>
      </div>`;
    }).join('');

    host.scrollTop = host.scrollHeight;
  }

  async function fetchChat(key) {
    const box = chat[key];
    if (!box.channel) return;

    const data = await api(`/api/chat?channel=${encodeURIComponent(box.channel)}&after=${box.lastId}`);
    if (!data.messages.length) return;

    box.messages.push(...data.messages);
    box.lastId = data.messages[data.messages.length - 1].id;

    renderChat(key);
    markRead(box.channel, box.lastId);
  }

  async function sendChat(key, text) {
    const box = chat[key];
    const body = String(text || '').trim();
    if (!body || !box.channel) return;

    const data = await api('/api/chat', { method: 'POST', body: { channel: box.channel, body } });

    box.messages.push(data.message);
    box.lastId = data.message.id;

    renderChat(key);
    markRead(box.channel, box.lastId);
  }

  function markRead(channel, lastId) {
    api('/api/chat/read', { method: 'POST', body: { channel, lastId } })
      .then(() => refreshChatBadge())
      .catch(() => { /* не критично */ });
  }

  async function refreshChatBadge() {
    const badge = $('#chatBadge');
    if (!badge) return;

    try {
      const data = await api('/api/chat/unread');

      if (data.total > 0) {
        badge.textContent = data.total > 99 ? '99+' : String(data.total);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    } catch (error) {
      /* на запертом рабочем месте просто не показываем */
    }
  }

  async function openGeneralChat() {
    chat.general.channel = 'general';

    if (!chat.general.messages.length) await fetchChat('general');
    else renderChat('general');

    markRead('general', chat.general.lastId);
  }

  async function openOrderChat(order) {
    const channel = 'order:' + order.id;

    if (chat.order.channel !== channel) {
      chat.order = { channel, messages: [], lastId: 0 };
    }

    renderChat('order');
    await fetchChat('order');
    markRead(channel, chat.order.lastId);
  }

  function startChatPolling() {
    setInterval(async () => {
      try {
        if (state.view === 'chat') await fetchChat('general');
        else if (state.view === 'order' && chat.order.channel) await fetchChat('order');
      } catch (error) {
        /* тихо: следующий тик повторит */
      }
    }, 5000);

    setInterval(() => {
      if (state.view !== 'chat') refreshChatBadge();
    }, 20000);
  }

  /* ---- Редактирование заказа ---------------------------------------------- */

  function openEditOrder() {
    const order = state.order;
    if (!order) return;

    fillPeopleSelect($('#editMaster'), painters());
    fillPeopleSelect($('#editBodyworker'), bodyworkers());

    if (order.master_id) $('#editMaster').value = String(order.master_id);
    if (order.bodyworker_id) $('#editBodyworker').value = String(order.bodyworker_id);

    $('#editPlate').value = order.plate || '';
    $('#editVin').value = order.vin || '';
    $('#editMake').value = order.make || '';
    $('#editModel').value = order.model || '';
    $('#editColor').value = order.color || '';
    $('#editOwnerName').value = order.owner_name || '';
    $('#editOwnerPhone').value = order.owner_phone || '';
    $('#editPlannedDate').value = order.planned_date || '';
    $('#editComment').value = order.comment || '';

    $('#editOrderModal').classList.add('open');
    $('#editPlate').focus();
  }

  function closeEditOrder() {
    $('#editOrderModal').classList.remove('open');
  }

  async function saveEditOrder() {
    const order = state.order;
    if (!order) return;

    try {
      const data = await api('/api/orders/' + order.id, {
        method: 'PATCH',
        body: {
          car: {
            plate: $('#editPlate').value,
            vin: $('#editVin').value,
            make: $('#editMake').value,
            model: $('#editModel').value,
            color: $('#editColor').value,
            owner_name: $('#editOwnerName').value,
            owner_phone: $('#editOwnerPhone').value
          },
          master_id: $('#editMaster').value ? Number($('#editMaster').value) : null,
          bodyworker_id: $('#editBodyworker').value ? Number($('#editBodyworker').value) : null,
          planned_date: $('#editPlannedDate').value || null,
          comment: $('#editComment').value
        }
      });

      state.order = data.order;
      closeEditOrder();
      renderOrder();
      toast('Изменения сохранены');
    } catch (error) {
      toast(error.message);
    }
  }

  /* ---- Добавление работы в существующий заказ ---------------------------- */

  function showWorkPicker(order) {
    const box = $('#addWorkToOrderBox');
    if (box.dataset.open === '1') {
      box.innerHTML = '';
      box.dataset.open = '0';
      return;
    }

    box.dataset.open = '1';
    box.innerHTML = `
      <div class="add-box">
        <select id="orderWorkSelect" style="width:100%;padding:9px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px"></select>
        <div class="actions-row">
          <input type="number" id="orderWorkQty" value="1" min="0.1" step="0.1"
                 style="width:100px;padding:8px;border:1px solid var(--border);border-radius:6px">
          <button class="btn btn-success" id="btnDoAddWork">Добавить</button>
        </div>
      </div>
    `;

    const select = $('#orderWorkSelect');
    state.works.forEach((work) => {
      const option = document.createElement('option');
      option.value = work.id;
      option.textContent = `${work.name} — ${money(work.price)}`;
      select.appendChild(option);
    });

    $('#btnDoAddWork').addEventListener('click', async () => {
      try {
        const data = await api(`/api/orders/${order.id}/works`, {
          method: 'POST',
          body: { work_id: Number(select.value), qty: Number($('#orderWorkQty').value) || 1 }
        });
        state.order = data.order;
        renderOrder();
        toast('Работа добавлена');
      } catch (error) {
        toast(error.message);
      }
    });
  }

  /* ---- Поиск материала и добавление в списание --------------------------- */

  function mountAddMaterial(order) {
    const box = $('#addMaterialBox');
    if (!box) return;

    box.innerHTML = `
      <div class="mode-tabs">
        <button data-mode="materials" class="active">Материалы</button>
        <button data-mode="recipes">Готовые краски</button>
      </div>

      <div id="addSearchWrap">
        <input type="text" id="matSearch" placeholder="Код или название материала…" autocomplete="off">
        <div class="search-results hidden" id="matResults"></div>
      </div>

      <div id="addRecipeWrap" class="hidden">
        <input type="text" id="recipeSearch" placeholder="Название цвета или код микса…" autocomplete="off">
        <div class="search-results" id="recipeResults" style="margin-top:8px"></div>
      </div>
    `;

    let mode = 'materials';

    box.querySelectorAll('.mode-tabs button').forEach((button) => {
      button.addEventListener('click', () => {
        mode = button.dataset.mode;
        box.querySelectorAll('.mode-tabs button').forEach((b) => b.classList.toggle('active', b === button));
        $('#addSearchWrap').classList.toggle('hidden', mode !== 'materials');
        $('#addRecipeWrap').classList.toggle('hidden', mode !== 'recipes');
        if (mode === 'recipes') renderRecipeSearch('');
      });
    });

    const search = $('#matSearch');
    let timer = null;

    search.addEventListener('input', () => {
      clearTimeout(timer);
      const value = search.value.trim();
      if (!value) {
        $('#matResults').classList.add('hidden');
        return;
      }
      timer = setTimeout(() => searchMaterials(value), 180);
    });

    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') $('#matResults').classList.add('hidden');
    });

    $('#recipeSearch').addEventListener('input', (event) => renderRecipeSearch(event.target.value.trim()));
    renderRecipeSearch('');
  }

  async function searchMaterials(term) {
    const wrap = $('#matResults');

    try {
      const data = await api('/api/materials?q=' + encodeURIComponent(term));
      wrap.innerHTML = '';

      if (!data.materials.length) {
        wrap.innerHTML = '<div class="row" style="cursor:default">Ничего не найдено</div>';
        wrap.classList.remove('hidden');
        return;
      }

      data.materials.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `
          <span class="code">${esc(item.code)}</span>
          <span class="name">${esc(item.name)}</span>
          <button class="btn btn-left btn-sm" data-kind="paint">◀ Эмаль</button>
          <button class="btn btn-right btn-sm" data-kind="material">Материал ▶</button>
        `;

        row.querySelectorAll('button').forEach((button) => {
          button.addEventListener('click', async (event) => {
            event.stopPropagation();
            await addMaterial(item, button.dataset.kind);
          });
        });

        wrap.appendChild(row);
      });

      wrap.classList.remove('hidden');
    } catch (error) {
      toast(error.message);
    }
  }

  async function addMaterial(item, kind) {
    if (!state.order) return;

    try {
      const data = await api(`/api/orders/${state.order.id}/materials`, {
        method: 'POST',
        body: {
          code: item.code,
          name: item.name,
          unit: kind === 'paint' ? 'г' : (item.unit || 'шт'),
          kind,
          qty: 1
        }
      });

      state.order = data.order;
      renderOrder();
      toast(`${item.name} — добавлено`);
    } catch (error) {
      toast(error.message);
    }
  }

  function renderRecipeSearch(term) {
    const wrap = $('#recipeResults');
    if (!wrap) return;

    const q = term.toLowerCase();

    const matched = state.recipes.filter((recipe) => {
      if (!q) return true;
      if (recipe.name.toLowerCase().includes(q)) return true;
      return recipe.mixes.some((mix) => (mix.code + ' ' + mix.name).toLowerCase().includes(q));
    }).slice(0, 20);

    wrap.innerHTML = '';

    if (!matched.length) {
      wrap.innerHTML = '<div class="row" style="cursor:default">Готовых красок нет — заведите их в «Справочниках»</div>';
      return;
    }

    matched.forEach((recipe) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <span class="name"><b>${esc(recipe.name)}</b><br>
          <span class="muted">${esc(recipe.mixes.map((m) => `${m.name} ${qty(m.amount)}`).join(' · '))}</span>
        </span>
        <input type="number" value="${qty(recipe.base)}" min="0.01" step="0.01"
               style="width:80px;padding:6px;border:1px solid var(--border);border-radius:5px" title="Сколько приготовить">
        <span class="muted">${esc(recipe.unit)}</span>
        <button class="btn btn-left btn-sm">→ В эмаль</button>
      `;

      const input = row.querySelector('input');
      const button = row.querySelector('button');

      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        await applyRecipe(recipe, Number(input.value));
      });

      wrap.appendChild(row);
    });
  }

  async function applyRecipe(recipe, volume) {
    if (!state.order) return;
    if (!(volume > 0)) {
      toast('Введите количество больше нуля');
      return;
    }

    const k = volume / recipe.base;

    try {
      for (const mix of recipe.mixes) {
        const amount = Math.round(mix.amount * k * 100) / 100;
        if (!(amount > 0)) continue;

        const data = await api(`/api/orders/${state.order.id}/materials`, {
          method: 'POST',
          body: { code: mix.code, name: mix.name, unit: recipe.unit, kind: 'paint', qty: amount }
        });
        state.order = data.order;
      }

      renderOrder();
      toast(`${recipe.name}: ${qty(volume)} ${recipe.unit} — добавлено`);
    } catch (error) {
      toast(error.message);
    }
  }

  /* ------------------------------------------------------------------------
     Новый заказ
     ------------------------------------------------------------------------ */

  function resetNewOrder() {
    state.newWorks = [];
    $('#newOrderForm').reset();
    renderNewWorks();

    fillPeopleSelect($('#masterSelect'), painters());
    fillPeopleSelect($('#bodyworkerSelect'), bodyworkers());

    const workSelect = $('#workSelect');
    workSelect.innerHTML = '';
    state.works.forEach((work) => {
      const option = document.createElement('option');
      option.value = work.id;
      option.textContent = `${work.name} — ${money(work.price)}`;
      workSelect.appendChild(option);
    });

    $('#carPlate').focus();
  }

  /** Маляры: работают с материалом и входят по ПИНу. */
  function painters() {
    return state.users.filter((user) => user.role === 'master' && user.active
      && !user.is_workstation && user.specialty !== 'bodyworker');
  }

  /** Кузовщики: пока только назначаются на заказ. */
  function bodyworkers() {
    return state.users.filter((user) => user.role === 'master' && user.active
      && user.specialty === 'bodyworker');
  }

  function fillPeopleSelect(select, people, emptyLabel = '— не назначен —') {
    if (!select) return;

    select.innerHTML = `<option value="">${emptyLabel}</option>`;

    people.forEach((person) => {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.full_name;
      select.appendChild(option);
    });
  }

  function renderNewWorks() {
    const box = $('#newWorksList');

    if (!state.newWorks.length) {
      box.innerHTML = '<div class="empty-line">Работы не выбраны</div>';
      updateNewTotals();
      return;
    }

    box.innerHTML = `
      <table class="lines">
        <thead><tr><th>Работа</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th><th></th></tr></thead>
        <tbody>
          ${state.newWorks.map((row, index) => `
            <tr>
              <td>${esc(row.name)}</td>
              <td class="num">${qty(row.qty)}</td>
              <td class="num">
                <input type="number" value="${row.price}" min="0" step="0.01" data-price="${index}"
                       style="width:110px">
              </td>
              <td class="num mono">${money(row.qty * row.price)}</td>
              <td class="num"><button class="row-del" data-del="${index}" type="button">×</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    box.querySelectorAll('[data-price]').forEach((input) => {
      input.addEventListener('change', () => {
        state.newWorks[Number(input.dataset.price)].price = Number(input.value) || 0;
        renderNewWorks();
      });
    });

    box.querySelectorAll('[data-del]').forEach((button) => {
      button.addEventListener('click', () => {
        state.newWorks.splice(Number(button.dataset.del), 1);
        renderNewWorks();
      });
    });

    updateNewTotals();
  }

  function updateNewTotals() {
    const sum = state.newWorks.reduce((acc, row) => acc + row.qty * row.price, 0);
    $('#newWorksSum').textContent = money(sum);
    $('#newTotal').textContent = money(sum);
  }

  async function prefillCar(plate) {
    const value = plate.trim();
    if (value.length < 5) return;

    try {
      const data = await api('/api/cars?q=' + encodeURIComponent(value));
      const found = data.cars.find((car) => car.plate.toUpperCase() === value.toUpperCase());
      if (!found) return;

      $('#carVin').value = found.vin || '';
      $('#carMake').value = found.make || '';
      $('#carModel').value = found.model || '';
      $('#carColor').value = found.color || '';
      $('#ownerName').value = found.owner_name || '';
      $('#ownerPhone').value = found.owner_phone || '';

      toast(`Машина уже была: ${found.visits} визит(ов)`);
    } catch (error) {
      /* подсказка — не критично */
    }
  }

  async function submitNewOrder(event) {
    event.preventDefault();

    const button = $('#btnCreateOrder');
    button.disabled = true;

    try {
      const data = await api('/api/orders', {
        method: 'POST',
        body: {
          car: {
            plate: $('#carPlate').value,
            vin: $('#carVin').value,
            make: $('#carMake').value,
            model: $('#carModel').value,
            color: $('#carColor').value,
            owner_name: $('#ownerName').value,
            owner_phone: $('#ownerPhone').value
          },
          master_id: $('#masterSelect').value ? Number($('#masterSelect').value) : null,
          bodyworker_id: $('#bodyworkerSelect').value ? Number($('#bodyworkerSelect').value) : null,
          planned_date: $('#plannedDate').value || null,
          comment: $('#orderComment').value,
          works: state.newWorks.map((row) => ({ work_id: row.work_id, qty: row.qty, price: row.price }))
        }
      });

      state.order = data.order;
      showView('order');
      renderOrder();
      toast('Заказ ' + data.order.number + ' создан');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  /* ------------------------------------------------------------------------
     Отчёт
     ------------------------------------------------------------------------ */

  function defaultPeriod() {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const iso = (d) => d.toISOString().slice(0, 10);
    return { from: iso(first), to: iso(today) };
  }

  async function loadReport() {
    const period = defaultPeriod();

    if (!$('#reportFrom').value) $('#reportFrom').value = period.from;
    if (!$('#reportTo').value) $('#reportTo').value = period.to;

    const from = $('#reportFrom').value;
    const to = $('#reportTo').value;

    const host = $('#reportBody');
    host.innerHTML = '<div class="spinner">Считаем…</div>';

    try {
      const data = await api(`/api/reports/summary?from=${from}&to=${to}`);

      const mastersRows = data.masters.length
        ? data.masters.map((row) => `
            <tr>
              <td>${esc(row.master_name)}</td>
              <td class="num">${row.orders}</td>
              <td class="num">${row.closed}</td>
              <td class="num">${row.in_work}</td>
              <td class="num mono">${money(row.works_sum)}</td>
              <td class="num mono">${money(row.materials_sum)}</td>
              <td class="num mono"><b>${money(row.total)}</b></td>
            </tr>`).join('')
        : '<tr><td colspan="7" class="empty-line">За этот период заказов нет</td></tr>';

      const materialsRows = data.materials.length
        ? data.materials.map((row) => `
            <tr>
              <td class="code-cell">${esc(row.code)}</td>
              <td>${esc(row.name)}</td>
              <td class="num">${qty(row.qty)} ${esc(row.unit)}</td>
              <td class="num mono">${money(row.cost)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="empty-line">Материалы не списывались</td></tr>';

      host.innerHTML = `
        <div class="card">
          <div class="card-head">
            <h2>По мастерам</h2>
            <span class="muted">${from} — ${to}</span>
          </div>

          <table class="grid">
            <thead>
              <tr>
                <th>Мастер</th><th class="num">Заказов</th><th class="num">Закрыто</th>
                <th class="num">В работе</th><th class="num">Работы</th>
                <th class="num">Материалы</th><th class="num">Итого</th>
              </tr>
            </thead>
            <tbody>${mastersRows}</tbody>
          </table>

          <div class="totals">
            <div><div class="t-k">Заказов</div><div class="t-v">${data.totals.orders}</div></div>
            <div><div class="t-k">Работы</div><div class="t-v">${money(data.totals.works_sum)}</div></div>
            <div><div class="t-k">Материалы</div><div class="t-v">${money(data.totals.materials_sum)}</div></div>
            <div><div class="t-k">Всего</div><div class="t-v grand">${money(data.totals.total)}</div></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Расход материалов</h2></div>
          <table class="grid">
            <thead><tr><th>Код</th><th>Наименование</th><th class="num">Кол-во</th><th class="num">Стоимость</th></tr></thead>
            <tbody>${materialsRows}</tbody>
          </table>
        </div>
      `;
    } catch (error) {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

  /* ------------------------------------------------------------------------
     Справочники
     ------------------------------------------------------------------------ */

  async function loadRefs() {
    renderWorksRef();
    renderRecipesRef();
    renderMaterialsRef();
  }

  function renderWorksRef() {
    const host = $('#worksTable');

    if (!state.works.length) {
      host.innerHTML = '<div class="empty-line">Прайс пуст</div>';
      return;
    }

    host.innerHTML = `
      <table class="grid">
        <thead><tr><th>Работа</th><th>Категория</th><th class="num">Цена</th></tr></thead>
        <tbody>
          ${state.works.map((work) => `
            <tr>
              <td>${esc(work.name)}</td>
              <td class="muted">${esc(work.category || '—')}</td>
              <td class="num">
                ${isManager()
                  ? `<input type="number" value="${work.price}" min="0" step="0.01" data-work-price="${work.id}"
                            style="width:120px;padding:6px;border:1px solid var(--border);border-radius:5px;text-align:right">`
                  : `<span class="mono">${money(work.price)}</span>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    host.querySelectorAll('[data-work-price]').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await api('/api/works/' + input.dataset.workPrice, {
            method: 'PATCH',
            body: { price: Number(input.value) || 0 }
          });
          const work = state.works.find((w) => String(w.id) === input.dataset.workPrice);
          if (work) work.price = Number(input.value) || 0;
          toast('Цена обновлена');
        } catch (error) {
          toast(error.message);
        }
      });
    });
  }

  function renderRecipesRef() {
    const host = $('#recipesList');

    if (!state.recipes.length) {
      host.innerHTML = '<div class="empty-line">Готовых красок пока нет</div>';
      return;
    }

    host.innerHTML = `
      <table class="grid">
        <thead><tr><th>Название</th><th>Состав</th><th></th></tr></thead>
        <tbody>
          ${state.recipes.map((recipe) => `
            <tr>
              <td><b>${esc(recipe.name)}</b><br><span class="muted">на ${qty(recipe.base)} ${esc(recipe.unit)}</span></td>
              <td class="muted">${esc(recipe.mixes.map((m) => `${m.name} — ${qty(m.amount)}`).join(' · '))}</td>
              <td class="num"><button class="btn btn-outline btn-sm" data-recipe="${esc(recipe.id)}">Изменить</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    host.querySelectorAll('[data-recipe]').forEach((button) => {
      button.addEventListener('click', () => {
        const recipe = state.recipes.find((r) => r.id === button.dataset.recipe);
        openRecipeEditor(recipe);
      });
    });
  }

  function renderMaterialsRef(term = '') {
    const host = $('#refMaterials');
    host.innerHTML = '<div class="spinner">Загрузка…</div>';

    api('/api/materials?q=' + encodeURIComponent(term)).then((data) => {
      if (!data.materials.length) {
        host.innerHTML = '<div class="empty-line">Ничего не найдено</div>';
        return;
      }

      host.innerHTML = `
        <table class="grid">
          <thead><tr><th>Код</th><th>Наименование</th><th class="num">Цена</th><th>Ед.</th></tr></thead>
          <tbody>
            ${data.materials.map((item) => `
              <tr>
                <td class="code-cell">${esc(item.code)}</td>
                <td>${esc(item.name)}</td>
                <td class="num">
                  ${isManager()
                    ? `<input type="number" value="${item.price}" min="0" step="0.01" data-mat-price="${esc(item.code)}"
                              style="width:110px;padding:6px;border:1px solid var(--border);border-radius:5px;text-align:right">`
                    : `<span class="mono">${money(item.price)}</span>`}
                </td>
                <td class="muted">${esc(item.unit)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      `;

      host.querySelectorAll('[data-mat-price]').forEach((input) => {
        input.addEventListener('change', async () => {
          try {
            await api('/api/materials/' + encodeURIComponent(input.dataset.matPrice), {
              method: 'PATCH',
              body: { price: Number(input.value) || 0 }
            });
            toast('Цена сохранена');
          } catch (error) {
            toast(error.message);
          }
        });
      });
    }).catch((error) => {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    });
  }

  /* ------------------------------------------------------------------------
     Редактор готовой краски
     ------------------------------------------------------------------------ */

  function openRecipeEditor(recipe) {
    state.editingRecipe = recipe || null;
    state.draftMixes = recipe ? JSON.parse(JSON.stringify(recipe.mixes)) : [];

    $('#recipeModalTitle').textContent = recipe ? 'Изменить краску' : 'Новая готовая краска';
    $('#recipeName').value = recipe ? recipe.name : '';
    $('#recipeBase').value = recipe ? recipe.base : 100;
    $('#recipeUnit').value = recipe ? recipe.unit : 'г';
    $('#recipeMixPicker').value = '';
    $('#recipeMixList').classList.remove('open');
    $('#btnDeleteRecipe').classList.toggle('hidden', !recipe);

    renderMixRows();
    updateMixSum();

    $('#recipeModal').classList.add('open');
    $('#recipeName').focus();
  }

  function closeRecipeEditor() {
    $('#recipeModal').classList.remove('open');
    state.editingRecipe = null;
    state.draftMixes = [];
  }

  function renderMixRows() {
    const host = $('#recipeMixRows');
    const unit = $('#recipeUnit').value;

    if (!state.draftMixes.length) {
      host.innerHTML = '<div class="empty-line">Миксов пока нет — добавьте в поле ниже</div>';
      return;
    }

    host.innerHTML = state.draftMixes.map((mix, index) => `
      <div class="mix-row" style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f4f4f7">
        <div class="mix-name" style="flex:1;font-size:13px">${esc(mix.code)} · ${esc(mix.name)}</div>
        <input type="number" value="${qty(mix.amount)}" min="0" step="0.01" data-mix="${index}"
               style="width:90px;padding:5px;border:1px solid var(--border);border-radius:5px;text-align:right">
        <span class="muted">${esc(unit)}</span>
        <button class="row-del" data-mix-del="${index}" type="button">×</button>
      </div>
    `).join('');

    host.querySelectorAll('[data-mix]').forEach((input) => {
      input.addEventListener('input', () => {
        state.draftMixes[Number(input.dataset.mix)].amount = Number(input.value) || 0;
        updateMixSum();
      });
    });

    host.querySelectorAll('[data-mix-del]').forEach((button) => {
      button.addEventListener('click', () => {
        state.draftMixes.splice(Number(button.dataset.mixDel), 1);
        renderMixRows();
        updateMixSum();
      });
    });
  }

  function updateMixSum() {
    const box = $('#recipeMixSum');
    const base = Number($('#recipeBase').value) || 0;
    const unit = $('#recipeUnit').value;

    if (!state.draftMixes.length) {
      box.className = 'mix-sum warn';
      box.textContent = 'Добавьте хотя бы один микс.';
      return;
    }

    const sum = Math.round(state.draftMixes.reduce((acc, m) => acc + (Number(m.amount) || 0), 0) * 100) / 100;
    const diff = Math.round((sum - base) * 100) / 100;

    if (base > 0 && Math.abs(diff) < 0.005) {
      box.className = 'mix-sum ok';
      box.textContent = `Сумма миксов: ${qty(sum)} ${unit} — ровно база ✓`;
    } else {
      box.className = 'mix-sum warn';
      box.textContent = `Сумма миксов: ${qty(sum)} ${unit}, база ${qty(base)} ${unit} — разница ${qty(diff)} ${unit}`;
    }
  }

  async function renderMixPicker() {
    const input = $('#recipeMixPicker');
    const list = $('#recipeMixList');
    const term = input.value.trim();

    list.innerHTML = '';

    if (!term) {
      list.classList.remove('open');
      return;
    }

    try {
      const data = await api('/api/materials?q=' + encodeURIComponent(term));
      if (!data.materials.length) {
        list.classList.remove('open');
        return;
      }

      data.materials.slice(0, 10).forEach((item) => {
        const row = document.createElement('div');
        row.innerHTML = `<span class="pk-code">${esc(item.code)}</span> ${esc(item.name)}`;
        row.addEventListener('click', () => {
          if (state.draftMixes.some((mix) => mix.code === item.code)) {
            toast('Этот микс уже есть в составе');
            return;
          }
          state.draftMixes.push({ code: item.code, name: item.name, amount: 0 });
          input.value = '';
          list.classList.remove('open');
          renderMixRows();
          updateMixSum();

          const inputs = $('#recipeMixRows').querySelectorAll('input[type=number]');
          if (inputs.length) {
            const last = inputs[inputs.length - 1];
            last.focus();
            last.select();
          }
        });
        list.appendChild(row);
      });

      list.classList.add('open');
    } catch (error) {
      toast(error.message);
    }
  }

  async function saveRecipe() {
    const payload = {
      name: $('#recipeName').value.trim(),
      base: Number($('#recipeBase').value) || 0,
      unit: $('#recipeUnit').value,
      mixes: state.draftMixes.map((mix) => ({
        code: mix.code,
        name: mix.name,
        amount: Math.round((Number(mix.amount) || 0) * 100) / 100
      }))
    };

    try {
      if (state.editingRecipe) {
        await api('/api/recipes/' + state.editingRecipe.id, { method: 'PUT', body: payload });
      } else {
        await api('/api/recipes', { method: 'POST', body: payload });
      }

      await loadRecipes();
      closeRecipeEditor();
      renderRecipesRef();
      toast('Сохранено');
    } catch (error) {
      toast(error.message);
    }
  }

  async function deleteRecipe() {
    if (!state.editingRecipe) return;
    if (!confirm(`Удалить краску «${state.editingRecipe.name}»?`)) return;

    try {
      await api('/api/recipes/' + state.editingRecipe.id, { method: 'DELETE' });
      await loadRecipes();
      closeRecipeEditor();
      renderRecipesRef();
      toast('Удалено');
    } catch (error) {
      toast(error.message);
    }
  }

  /* ---- Смена своего пароля ------------------------------------------------ */

  function openPasswordModal() {
    $('#passCurrent').value = '';
    $('#passNext').value = '';
    $('#passRepeat').value = '';
    $('#passwordModal').classList.add('open');
    $('#passCurrent').focus();
  }

  function closePasswordModal() {
    $('#passwordModal').classList.remove('open');
  }

  async function savePassword() {
    const current = $('#passCurrent').value;
    const next = $('#passNext').value;
    const repeat = $('#passRepeat').value;

    if (next.length < 6) {
      toast('Новый пароль короче 6 символов');
      return;
    }

    if (next !== repeat) {
      toast('Пароли не совпадают');
      return;
    }

    try {
      await api('/api/me/password', { method: 'POST', body: { current, next } });
      closePasswordModal();
      toast('Пароль изменён');
    } catch (error) {
      toast(error.message);
    }
  }

  /* ------------------------------------------------------------------------
     Сотрудники
     ------------------------------------------------------------------------ */

  async function loadUsers() {
    const host = $('#usersTable');
    host.innerHTML = '<div class="spinner">Загрузка…</div>';

    try {
      const data = await api('/api/users');
      state.users = data.users;

      host.innerHTML = `
        <table class="grid">
          <thead><tr><th>ФИО</th><th>Логин</th><th>Роль</th><th>ПИН-код</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            ${data.users.map((user) => `
              <tr>
                <td>${esc(user.full_name)}</td>
                <td class="muted">${esc(user.login)}</td>
                <td>${esc(roleLabel(user))}${user.is_workstation ? ' <span class="muted">(общий вход)</span>' : ''}</td>
                <td>${user.role === 'master' && !user.is_workstation && user.specialty !== 'bodyworker'
                  ? `<button class="btn btn-outline btn-sm" data-pin-user="${user.id}"
                             data-pin-name="${esc(user.full_name)}">${user.pin_set ? 'Сменить ПИН' : 'Задать ПИН'}</button>`
                  : '<span class="muted">—</span>'}</td>
                <td>${user.active ? 'работает' : '<span class="muted">отключён</span>'}</td>
                <td class="num"><button class="btn btn-outline btn-sm" data-edit-user="${user.id}">Изменить</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      `;

      host.querySelectorAll('[data-pin-user]').forEach((button) => {
        button.addEventListener('click', () => setPinFor(button.dataset.pinUser, button.dataset.pinName));
      });

      renderRoleLabelsForm();

      host.querySelectorAll('[data-edit-user]').forEach((button) => {
        button.addEventListener('click', () => {
          const target = state.users.find((user) => String(user.id) === button.dataset.editUser);
          if (target) openUserEditor(target);
        });
      });
    } catch (error) {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

  /** Мастеру задаётся 4-значный ПИН — по нему он входит на общем компьютере. */
  async function setPinFor(userId, fullName) {
    const pin = prompt(`ПИН-код для ${fullName} (ровно 4 цифры)`);
    if (pin === null) return;

    try {
      await api(`/api/users/${userId}/pin`, { method: 'POST', body: { pin } });
      await loadUsers();
      toast('ПИН-код сохранён');
    } catch (error) {
      toast(error.message);
    }
  }

  /* ---- Названия ролей ------------------------------------------------------ */

  const ROLE_TITLES = {
    admin: 'Администратор',
    manager: 'Приёмщик / начальник',
    painter: 'Маляр',
    bodyworker: 'Кузовщик',
    store: 'Склад',
    workstation: 'Рабочее место мастеров'
  };

  async function loadRoleLabels() {
    if (!isManager()) return;

    try {
      const data = await api('/api/settings/roles');
      state.roleLabels = data.labels;
    } catch (error) {
      /* останутся стандартные */
    }
  }

  function renderRoleLabelsForm() {
    const host = $('#roleLabelsGrid');
    if (!host) return;

    const labels = state.roleLabels || ROLE_DEFAULTS;

    host.innerHTML = Object.keys(ROLE_DEFAULTS).map((key) => `
      <div class="field">
        <label for="role-${key}">${ROLE_TITLES[key]}</label>
        <input type="text" id="role-${key}" maxlength="40" value="${esc(labels[key])}" autocomplete="off">
      </div>`).join('');
  }

  /** Одна и та же роль называется одинаково и в таблице, и в выпадающих списках. */
  function updateRoleSelectLabels() {
    const labels = state.roleLabels || ROLE_DEFAULTS;

    document.querySelectorAll('option[data-role]').forEach((option) => {
      const label = labels[option.dataset.role];
      if (!label) return;

      // В списке — с заглавной буквы, в таблице роль пишется строчными
      const красиво = label.charAt(0).toUpperCase() + label.slice(1);

      option.textContent = option.dataset.role === 'workstation'
        ? `${красиво} (общий вход)`
        : красиво;
    });
  }

  /** reset = true — вернуть стандартные названия (пустые значения сервер заменит ими). */
  async function saveRoleLabels(reset = false) {
    const labels = {};

    Object.keys(ROLE_DEFAULTS).forEach((key) => {
      if (reset) {
        labels[key] = '';
        return;
      }

      const input = document.getElementById('role-' + key);
      if (input) labels[key] = input.value.trim();
    });

    try {
      const data = await api('/api/settings/roles', { method: 'PUT', body: { labels } });
      state.roleLabels = data.labels;

      applyRole();
      updateRoleSelectLabels();
      renderRoleLabelsForm();
      await loadUsers();
      toast(reset ? 'Вернули стандартные названия' : 'Названия ролей сохранены');
    } catch (error) {
      toast(error.message);
    }
  }

  /* ---- Редактирование сотрудника ------------------------------------------ */

  let editingUserId = null;

  function openUserEditor(user) {
    editingUserId = user.id;

    $('#editUserTitle').textContent = user.full_name;
    $('#editUserName').value = user.full_name || '';

    const roleValue = user.specialty === 'bodyworker' ? 'bodyworker' : (user.is_workstation ? 'master' : user.role);
    $('#editUserRole').value = roleValue;
    $('#editUserRole').disabled = Boolean(user.is_workstation);

    $('#editUserPassword').value = '';
    $('#editUserPin').value = '';

    const canPin = user.role === 'master' && !user.is_workstation && user.specialty !== 'bodyworker';
    $('#editUserPinField').classList.toggle('hidden', !canPin);

    const active = $('#editUserActive');
    active.checked = Boolean(user.active);
    active.disabled = Number(user.id) === Number(state.user.id);

    $('#editUserModal').classList.add('open');
    $('#editUserName').focus();
  }

  function closeUserEditor() {
    $('#editUserModal').classList.remove('open');
    editingUserId = null;
  }

  async function saveUser() {
    if (!editingUserId) return;

    const name = $('#editUserName').value.trim();
    if (!name) {
      toast('Укажите ФИО');
      return;
    }

    const password = $('#editUserPassword').value;
    if (password && password.length < 6) {
      toast('Пароль короче 6 символов');
      return;
    }

    const payload = {
      full_name: name,
      role: $('#editUserRole').value,
      active: $('#editUserActive').checked
    };

    if (password) payload.password = password;

    try {
      await api('/api/users/' + editingUserId, { method: 'PATCH', body: payload });

      const pin = $('#editUserPin').value.trim();
      if (pin) {
        await api(`/api/users/${editingUserId}/pin`, { method: 'POST', body: { pin } });
      }

      await loadUsers();
      closeUserEditor();
      toast('Сохранено');
    } catch (error) {
      toast(error.message);
    }
  }

  async function addUser() {
    try {
      await api('/api/users', {
        method: 'POST',
        body: {
          login: $('#newUserLogin').value.trim(),
          full_name: $('#newUserName').value.trim(),
          role: $('#newUserRole').value,
          password: $('#newUserPassword').value,
          pin: $('#newUserPin').value.trim() || undefined
        }
      });

      await loadUsers();
      $('#newUserLogin').value = '';
      $('#newUserName').value = '';
      $('#newUserPassword').value = '';
      $('#newUserPin').value = '';
      toast('Сотрудник добавлен');
    } catch (error) {
      toast(error.message);
    }
  }

  /* ------------------------------------------------------------------------
     Загрузка справочников
     ------------------------------------------------------------------------ */

  async function loadWorks() {
    const data = await api('/api/works');
    state.works = data.works;
  }

  async function loadRecipes() {
    const data = await api('/api/recipes');
    state.recipes = data.recipes;
  }

  /* ------------------------------------------------------------------------
     Установка как приложение (PWA)
     ------------------------------------------------------------------------ */

  let installPrompt = null;

  function openInstallHelp() {
    $('#installModal').classList.add('open');
  }

  function closeInstallHelp() {
    $('#installModal').classList.remove('open');
  }

  function setupInstall() {
    const button = $('#navInstall');
    if (!button) return;

    // Уже открыто как приложение — кнопка не нужна
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;

    if (standalone) button.classList.add('hidden');

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installPrompt = event;
    });

    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      button.classList.add('hidden');
      toast('Приложение установлено');
    });

    button.addEventListener('click', async () => {
      if (installPrompt) {
        installPrompt.prompt();
        const choice = await installPrompt.userChoice.catch(() => null);
        installPrompt = null;
        if (choice && choice.outcome === 'accepted') toast('Устанавливаем приложение…');
        return;
      }

      openInstallHelp();
    });

    $('#btnCloseInstall').addEventListener('click', closeInstallHelp);
    $('#btnCloseInstall2').addEventListener('click', closeInstallHelp);
  }

  /* ------------------------------------------------------------------------
     Запуск
     ------------------------------------------------------------------------ */

  function applyRole() {
    const user = state.user;

    $('#userName').textContent = user.full_name;
    const badge = $('#userRole');
    badge.textContent = roleLabel(user);
    badge.className = 'role-badge ' + user.role;

    $('#btnNewOrder').classList.toggle('hidden', !isManager());
    $('#navUsers').classList.toggle('hidden', user.role !== 'admin');

    if (state.workstation) $('#btnLock').classList.remove('hidden');

    // Отчёт — для начальства и склада; мастеру он пока не нужен
    const reportNav = document.querySelector('.nav-btn[data-view="report"]');
    if (reportNav) reportNav.classList.toggle('hidden', isMaster());

    // Правка прайса — только приёмщику и админу
    const addWorkBar = $('#btnAddWorkRef') ? $('#btnAddWorkRef').closest('.toolbar') : null;
    if (addWorkBar) addWorkBar.classList.toggle('hidden', !isManager());

    if (isMaster()) {
      $('#orderSearch').placeholder = 'Номер заказа, госномер, модель…';
    }
  }

  function bindEvents() {
    $$('.nav-btn').forEach((button) => {
      button.addEventListener('click', () => showView(button.dataset.view));
    });

    $('#btnLogout').addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch (error) { /* всё равно уходим */ }
      location.href = '/login.html';
    });

    $('#btnLock').addEventListener('click', lockWorkstation);

    $('#btnPassword').addEventListener('click', openPasswordModal);
    $('#btnClosePassword').addEventListener('click', closePasswordModal);
    $('#btnCancelPassword').addEventListener('click', closePasswordModal);
    $('#btnSavePassword').addEventListener('click', savePassword);

    $('#btnNewOrder').addEventListener('click', () => showView('new'));
    $('#btnCancelNew').addEventListener('click', () => showView('orders'));

    let searchTimer = null;
    $('#orderSearch').addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      const value = event.target.value.trim();
      searchTimer = setTimeout(() => {
        state.orderFilter.q = value;
        loadOrders();
      }, 220);
    });

    $('#btnAddWork').addEventListener('click', () => {
      const select = $('#workSelect');
      const work = state.works.find((w) => String(w.id) === select.value);
      if (!work) return;

      state.newWorks.push({
        work_id: work.id,
        name: work.name,
        qty: Number($('#workQty').value) || 1,
        price: work.price
      });
      renderNewWorks();
    });

    $('#carPlate').addEventListener('blur', (event) => prefillCar(event.target.value));
    $('#newOrderForm').addEventListener('submit', submitNewOrder);

    $('#btnReport').addEventListener('click', loadReport);

    $('#refMaterialSearch').addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      const value = event.target.value.trim();
      searchTimer = setTimeout(() => renderMaterialsRef(value), 250);
    });

    $('#btnAddWorkRef').addEventListener('click', async () => {
      try {
        await api('/api/works', {
          method: 'POST',
          body: {
            name: $('#newWorkName').value.trim(),
            category: $('#newWorkCategory').value.trim(),
            price: Number($('#newWorkPrice').value) || 0
          }
        });
        await loadWorks();
        renderWorksRef();
        $('#newWorkName').value = '';
        $('#newWorkCategory').value = '';
        $('#newWorkPrice').value = '';
        toast('Работа добавлена');
      } catch (error) {
        toast(error.message);
      }
    });

    $('#btnNewRecipe').addEventListener('click', () => openRecipeEditor(null));
    $('#btnCloseRecipe').addEventListener('click', closeRecipeEditor);
    $('#btnCancelRecipe').addEventListener('click', closeRecipeEditor);
    $('#btnSaveRecipe').addEventListener('click', saveRecipe);
    $('#btnDeleteRecipe').addEventListener('click', deleteRecipe);

    $('#recipeBase').addEventListener('input', updateMixSum);
    $('#recipeUnit').addEventListener('change', () => {
      renderMixRows();
      updateMixSum();
    });
    $('#recipeMixPicker').addEventListener('input', renderMixPicker);

    $('#btnAddUser').addEventListener('click', addUser);
    setupInstall();
    $('#btnSaveRoleLabels').addEventListener('click', () => saveRoleLabels(false));
    $('#btnResetRoleLabels').addEventListener('click', () => saveRoleLabels(true));

    $('#chatForm').addEventListener('submit', async (event) => {
      event.preventDefault();

      const input = $('#chatInput');
      const text = input.value;
      input.value = '';

      try {
        await sendChat('general', text);
      } catch (error) {
        toast(error.message);
      }
    });

    $('#btnCloseEditOrder').addEventListener('click', closeEditOrder);
    $('#btnCancelEditOrder').addEventListener('click', closeEditOrder);
    $('#btnSaveEditOrder').addEventListener('click', saveEditOrder);

    $('#btnCloseEditUser').addEventListener('click', closeUserEditor);
    $('#btnCancelEditUser').addEventListener('click', closeUserEditor);
    $('#btnSaveEditUser').addEventListener('click', saveUser);

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.picker')) $('#recipeMixList').classList.remove('open');
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if ($('#recipeModal').classList.contains('open')) closeRecipeEditor();
      if ($('#editOrderModal').classList.contains('open')) closeEditOrder();
      if ($('#passwordModal').classList.contains('open')) closePasswordModal();
      if ($('#editUserModal').classList.contains('open')) closeUserEditor();
      if ($('#installModal').classList.contains('open')) closeInstallHelp();
    });
  }

  async function boot() {
    let me;

    try {
      me = await api('/api/me');
    } catch (error) {
      location.href = '/login.html';
      return;
    }

    state.workstation = Boolean(me.workstation);
    state.idleMinutes = me.idle_minutes || 10;

    // Рабочее место мастеров: сначала показываем ПИН, кабинет откроется после него
    if (state.workstation && (!me.user || me.locked)) {
      showPinScreen();
      return;
    }

    if (!me.user) {
      location.href = '/login.html';
      return;
    }

    state.user = me.user;
    startApp();
  }

  async function startApp() {
    await loadRoleLabels();
    applyRole();
    updateRoleSelectLabels();
    renderStatusChips();

    try {
      await Promise.all([loadWorks(), loadRecipes()]);
      const users = await api('/api/users').catch(() => ({ users: [] }));
      state.users = users.users || [];
    } catch (error) {
      toast(error.message);
    }

    bindEvents();

    startChatPolling();
    refreshChatBadge();

    // Автовыход по бездействию — только на общем компьютере мастеров
    if (state.workstation) {
      ['click', 'keydown', 'mousemove', 'touchstart'].forEach((name) => {
        document.addEventListener(name, resetIdle, { passive: true });
      });
      resetIdle();
    }

    showView('orders');
  }

  /* ------------------------------------------------------------------------
     ПИН-код рабочего места
     ------------------------------------------------------------------------ */

  let pinInput = '';

  function showPinScreen() {
    $('#pinScreen').classList.remove('hidden');
    pinInput = '';
    renderPinDots();

    const error = $('#pinError');
    error.textContent = '';
    error.classList.add('hidden');

    const hint = $('#pinHint');
    if (hint) hint.textContent = `Если не выходили сами, кабинет закроется через ${state.idleMinutes} мин бездействия`;
  }

  function renderPinDots() {
    $$('#pinDots span').forEach((dot, index) => {
      dot.classList.toggle('filled', index < pinInput.length);
    });
  }

  function pinKey(key) {
    if (key === 'clear') pinInput = '';
    else if (key === 'back') pinInput = pinInput.slice(0, -1);
    else if (/^[0-9]$/.test(key) && pinInput.length < 4) pinInput += key;

    renderPinDots();

    if (pinInput.length === 4) submitPin();
  }

  async function submitPin() {
    const pin = pinInput;

    try {
      await api('/api/unlock', { method: 'POST', body: { pin } });
      location.reload();
    } catch (error) {
      pinInput = '';
      renderPinDots();

      const box = $('#pinError');
      box.textContent = error.message;
      box.classList.remove('hidden');

      const card = $('.pin-box');
      card.classList.add('pin-shake');
      setTimeout(() => card.classList.remove('pin-shake'), 350);
    }
  }

  let idleTimer = null;

  function resetIdle() {
    if (!state.workstation || !state.user) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(lockWorkstation, (state.idleMinutes || 10) * 60 * 1000);
  }

  async function lockWorkstation() {
    try {
      await api('/api/lock', { method: 'POST' });
    } catch (error) {
      /* уже закрыт — не страшно */
    }
    location.reload();
  }

  function bindPinEvents() {
    $('#pinPad').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-key]');
      if (button) pinKey(button.dataset.key);
    });

    document.addEventListener('keydown', (event) => {
      if ($('#pinScreen').classList.contains('hidden')) return;

      if (/^[0-9]$/.test(event.key)) {
        pinKey(event.key);
        event.preventDefault();
      } else if (event.key === 'Backspace') {
        pinKey('back');
        event.preventDefault();
      }
    });

    $('#btnPinExit').addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch (error) { /* всё равно уходим */ }
      location.href = '/login.html';
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* не критично */ });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindPinEvents();
    boot();
  });
})();
