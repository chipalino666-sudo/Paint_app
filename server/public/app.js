'use strict';

/* ==========================================================================
   Клиент: заказы, карточка заказа, списание материалов, отчёты, справочники.
   ========================================================================== */

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  /** Светлая и тёмная тема: выбор запоминается в браузере. */
  function setTheme(name) {
    if (name === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    try { localStorage.setItem('theme', name); } catch (error) { /* приватный режим */ }

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', name === 'dark' ? '#0b1220' : '#2563eb');

    const button = document.getElementById('btnTheme');
    if (button) {
      const label = name === 'dark' ? 'Светлая тема' : 'Тёмная тема';
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }

  function applyStoredTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(dark ? 'dark' : 'light');
  }

  /* ------------------------------------------------------------------------
     Звук нового сообщения
     ------------------------------------------------------------------------ */

  let audioContext = null;
  let lastUnreadTotal = null;

  function ensureAudio() {
    if (audioContext) return audioContext;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;

    try {
      audioContext = new Ctx();
    } catch (error) {
      return null;
    }

    return audioContext;
  }

  /** Короткий двойной сигнал — слышно, но не назойливо. */
  function playPing() {
    if (document.documentElement.dataset.sound === 'off') return;

    const ctx = ensureAudio();
    if (!ctx) return;

    // Браузер разрешает звук только после действия пользователя
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* пока нельзя */ });
      return;
    }

    const now = ctx.currentTime;

    [880, 1320].forEach((frequency, index) => {
      const start = now + index * 0.12;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start(start);
      oscillator.stop(start + 0.32);
    });
  }

  function setSound(on) {
    document.documentElement.dataset.sound = on ? 'on' : 'off';

    try {
      localStorage.setItem('sound', on ? 'on' : 'off');
    } catch (error) { /* приватный режим */ }

    const button = document.getElementById('btnSound');

    if (button) {
      const label = on ? 'Выключить звук' : 'Включить звук';
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }

  function applyStoredSound() {
    setSound(document.documentElement.dataset.sound !== 'off');
  }

  /** Телефон или узкое окно — тот же порог, что в стилях. */
  const isMobile = () => window.innerWidth <= 780;

  /**
   * Браузер любит подставлять сохранённый логин в первое текстовое поле страницы.
   * Держим поле «закрытым» до первого касания и стираем всё, что появилось без ввода.
   * Opera умеет вставлять значение молча, без событий, поэтому ещё и проверяем таймером.
   */
  /**
   * Только подсказки для менеджеров паролей.
   * Раньше здесь был readonly и стирание «чужих» значений — из-за этого
   * пропадали названия, которые программа подставила сама.
   */
  /** Рыхлое сравнение: пробелы, дефисы и точки не мешают искать. */
  function looseKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[\s\-_.\/\\]+/g, '');
  }

  function shieldInput(input) {
    if (!input || input.dataset.shielded === '1') return;
    if (input.getAttribute('autocomplete') === 'tel') return;
    if (input.dataset.noshield === '1') return;

    input.dataset.shielded = '1';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('data-form-type', 'other');
    input.setAttribute('data-lpignore', 'true');
  }
  function shieldInputs(root) {
    const host = root || document;
    host.querySelectorAll('input[type="text"], input[type="search"], input:not([type])').forEach(shieldInput);

    // Поисковые поля: браузер любит подставлять в них сохранённый логин
    host.querySelectorAll('input[type="search"], [data-noshield="1"]').forEach(guardSearchInput);
  }

  /**
   * Не даём браузеру подставлять логин в поиск.
   * Чистим поле, только если в нём оказался логин текущего пользователя.
   */
  function guardSearchInput(input) {
    if (!input || input.dataset.autofillGuard === '1') return;

    input.dataset.autofillGuard = '1';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('data-form-type', 'other');
    input.setAttribute('data-lpignore', 'true');

    const clearLogin = () => {
      const login = String((state.user && state.user.login) || '').toLowerCase();
      if (!login) return;

      const value = String(input.value || '').trim().toLowerCase();

      if (value && value === login) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    input.addEventListener('focus', clearLogin);
    input.addEventListener('pointerdown', clearLogin);

    // Браузер может вставить логин уже после фокуса — ловим и это
    input.addEventListener('input', clearLogin);
    input.addEventListener('change', clearLogin);

    startAutofillWatch();
  }

  /** Общая проверка: во всех поисковых полях не должно быть логина. */
  function startAutofillWatch() {
    if (window.__autofillWatch) return;
    window.__autofillWatch = true;

    setInterval(() => {
      const login = String((state.user && state.user.login) || '').trim().toLowerCase();
      if (!login) return;

      document.querySelectorAll('input[data-autofill-guard="1"]').forEach((input) => {
        if (String(input.value || '').trim().toLowerCase() === login) {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }, 700);
  }

  const STATUS_HINT = {
    accepted: 'Машина принята. «В работе» станет сама, как только добавят работу или спишут материал',
    in_work: 'Работа идёт: работы и списание открыты',
    ready: 'Работа закончена, списание закрыто. Мастер или приёмщик могут вернуть в работу',
    closed: 'Машина выдана, менять ничего нельзя',
    cancelled: 'Заказ отменён'
  };

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
    statusChanges: {},
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
    roleLabels: null,
    unreadOrders: {},
    orderTab: 'order',
    codes: [],
    clients: [],
    stock: []
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

  /* ------------------------------------------------------------------------
     Кнопка «Назад» на телефоне
     Без этого браузер уводил на страницу входа. Теперь «назад» листает
     экраны программы, а на главном остаётся внутри.
     ------------------------------------------------------------------------ */

  let historyRestoring = false;

  function pushAppState() {
    try {
      history.pushState({ app: true }, '', location.href);
    } catch (error) { /* не критично */ }
  }

  function showView(name) {
    // В режиме рабочего стола разделы открываются окнами, а не подменяют экран
    if (typeof uiMode === 'function' && uiMode() === 'desk') {
      if (name === 'home') { minimizeAllDeskWindows(); return; }

      deskNavigate(name);
      return;
    }
    if (name === 'home' && typeof loadDesk === 'function') loadDesk();
    state.view = name;
    shieldInputs();

    if (!historyRestoring) pushAppState();

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
    if (name === 'clients') loadClients();
    if (name === 'stock') loadWarehouse();
    if (name === 'tds') loadTdsView();
    if (name === 'norms') loadNormsView();
    if (name === 'users') loadUsers();
  if (name === 'logins') loadLogins();
    if (name === 'tasks') loadTasks();
    if (name === 'new') resetNewOrder();

    // На телефоне после перехода страница не должна оставаться прокрученной
    window.scrollTo(0, 0);
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
    if (!box) return;

    const changes = state.statusChanges || {};
    box.innerHTML = '';

    FILTERS.forEach((filter) => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (state.orderFilter.status === filter.id ? ' active' : '');

      const label = document.createElement('span');
      label.textContent = filter.label;
      chip.appendChild(label);

      // Цифра подсказывает, в какую именно вкладку попали изменённые заказы
      const count = filter.id === 'open'
        ? (Number(changes.accepted) || 0) + (Number(changes.in_work) || 0) + (Number(changes.ready) || 0)
        : Number(changes[filter.id]) || 0;

      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'chip-badge';
        badge.textContent = count > 99 ? '99+' : String(count);
        chip.appendChild(badge);
      }

      chip.addEventListener('click', () => {
        state.orderFilter.status = filter.id;
        renderStatusChips();
        loadOrders();
        markStatusSeen(filter.id);
      });

      box.appendChild(chip);
    });
  }

  /** Открыли вкладку статуса — её изменения больше не «новые». */
  async function markStatusSeen(status) {
    const changes = state.statusChanges || {};
    const affected = status === 'open'
      ? ['accepted', 'in_work', 'ready']
      : [status];

    if (!affected.some((key) => Number(changes[key]) > 0)) return;

    try {
      for (const key of affected) {
        if (Number(changes[key]) > 0) {
          await api('/api/orders/status-seen', { method: 'POST', body: { status: key } });
          delete changes[key];
        }
      }

      state.statusChanges = changes;
      renderStatusChips();
    } catch (error) {
      /* не критично */
    }
  }

  /** silent = true — обновить в фоне, без надписи «Загрузка…» */
  async function loadOrders(silent = false) {
    const body = $('#ordersBody');
    if (!silent) body.innerHTML = '<tr><td colspan="6" class="spinner">Загрузка…</td></tr>';

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
      if (!silent) body.innerHTML = `<tr><td colspan="6" class="empty-line">${esc(error.message)}</td></tr>`;
    }
  }

  /** Плашки у заказа: новое сообщение и/или изменения. */
  function orderNotice(order) {
    const parts = [];

    if (Number(order.unread_chat) > 0) {
      parts.push('<span class="notify notify-chat">Новое сообщение</span>');
    }

    if (Number(order.unread_changes) > 0) {
      parts.push('<span class="notify notify-edit">Изменения</span>');
    }

    return parts.length ? '<div class="notify-line">' + parts.join('') + '</div>' : '';
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

        if (Number(order.unread_chat) > 0 || Number(order.unread_changes) > 0) {
          card.classList.add('unread');
        }

        card.innerHTML = `
          <div class="oc-top">
            <span class="order-number">${esc(order.number)}</span>
            <span class="status-pill status-${esc(order.status)}" title="${esc(STATUS_HINT[order.status] || '')}">${esc(STATUS[order.status] || order.status)}</span>
          </div>
          ${orderNotice(order)}
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

    body.innerHTML = state.orders.map((order) => {
      const hasNews = Number(order.unread_chat) > 0 || Number(order.unread_changes) > 0;

      return `
      <tr data-id="${order.id}"${hasNews ? ' class="unread"' : ''}>
        <td><span class="order-number">${esc(order.number)}</span>${orderNotice(order)}</td>
        <td>
          <div>${esc(order.plate)}</div>
          <div class="muted">${esc([order.make, order.model].filter(Boolean).join(' '))}</div>
        </td>
        <td>${esc(order.master_name || '—')}${order.bodyworker_name
          ? `<div class="muted">кузовщик: ${esc(order.bodyworker_name)}</div>` : ''}</td>
        <td><span class="status-pill status-${esc(order.status)}" title="${esc(STATUS_HINT[order.status] || '')}">${esc(STATUS[order.status] || order.status)}</span></td>
        <td class="muted">${dateText(order.created_at)}</td>
        <td class="num mono">${money(order.total)}</td>
      </tr>`;
    }).join('');

    [...body.rows].forEach((row) => {
      row.addEventListener('click', () => openOrder(row.dataset.id));
    });
  }

  /* ------------------------------------------------------------------------
     Карточка заказа
     ------------------------------------------------------------------------ */

  /* --------------------------------------------------------------------------
   Ярлыки рабочего стола: пользователь сам собирает набор плиток
   -------------------------------------------------------------------------- */

const DESK_SHORTCUTS = [
  { key: 'orders', title: 'Заказы', icon: '📋', count: 'orders' },
  { key: 'accepted', title: 'Приняты', icon: '🕓', count: 'accepted', filter: 'accepted' },
  { key: 'in_work', title: 'В работе', icon: '🔧', count: 'in_work', filter: 'in_work' },
  { key: 'ready', title: 'Готовы', icon: '✅', count: 'ready', filter: 'ready' },
  { key: 'tasks', title: 'Задачи', icon: '🗒️', count: 'tasks' },
  { key: 'lowstock', title: 'Пора заказать', icon: '🛒', count: 'stock', target: 'stock' },
  { key: 'stock', title: 'Склад', icon: '📦' },
  { key: 'tds', title: 'ТДС и паспорта', icon: '📄', count: 'tds' },
  { key: 'norms', title: 'Нормы списания', icon: '⚖️' },
  { key: 'refs', title: 'Справочники', icon: '📚' },
  { key: 'report', title: 'Отчёт', icon: '📈' },
  { key: 'clients', title: 'Клиенты', icon: '👥' },
  { key: 'chat', title: 'Обсуждения', icon: '💬' },
  { key: 'ai', title: 'Помощник', icon: '🤖' },
  { key: 'new', title: 'Новый заказ', icon: '➕' },
  { key: 'users', title: 'Сотрудники', icon: '🧑‍🔧' },
  { key: 'apps', title: 'Программы', icon: '🖥️' }
];


const DEFAULT_DESK = ['orders', 'accepted', 'in_work', 'ready', 'tasks', 'lowstock', 'tds', 'norms', 'refs', 'ai', 'new'];

function currentDeskItems() {
  const saved = state.user && state.user.desk_items;

  if (Array.isArray(saved) && saved.length) return saved;

  return DEFAULT_DESK.filter((key) => key !== 'users' || (state.user && state.user.role === 'admin'));
}

/** Считаем цифры для плиток. */
async function deskCounts() {
  const counts = {};
  let orders = [];

  try {
    orders = (await api('/api/orders')).orders || [];
  } catch (error) { /* без заказов */ }

  const byStatus = (status) => orders.filter((row) => row.status === status).length;

  counts.orders = byStatus('accepted') + byStatus('in_work');
  counts.accepted = byStatus('accepted');
  counts.in_work = byStatus('in_work');
  counts.ready = byStatus('ready');

  try {
    counts.tasks = ((await api('/api/tasks?status=open')).counts || {}).today || 0;
    const low = await api('/api/tasks?status=open');
    counts.tasks = (low.counts.overdue || 0) + (low.counts.today || 0);
  } catch (error) { /* нет доступа */ }

  try {
    counts.stock = ((await api('/api/stock/low')).items || []).length;
  } catch (error) { /* нет доступа */ }

  try {
    counts.tds = ((await api('/api/tds')).docs || []).length;
  } catch (error) { /* нет доступа */ }

  return counts;
}

/** Отрисовка стола по сохранённому набору ярлыков. */
async function renderDeskShortcuts() {
  const grid = $('#deskGrid');
  if (!grid) return;

  const items = currentDeskItems();
  const counts = await deskCounts();

  const tiles = items.map((key) => {
    const item = DESK_SHORTCUTS.find((row) => row.key === key);
    if (!item) return '';

    const count = item.count && counts[item.count] !== undefined ? counts[item.count] : null;

    return `<button class="desk-tile" data-desk="${esc(item.key)}">
      <span class="desk-tile-icon">${item.icon}</span>
      <span class="desk-tile-title">${esc(item.title)}</span>
      ${count !== null ? `<span class="desk-tile-count">${esc(String(count))}</span>` : ''}
    </button>`;
  }).join('');

  grid.innerHTML = tiles + `<button class="desk-tile desk-tile-add" data-desk-add="1" title="Добавить ярлык">
      <span class="desk-tile-icon">＋</span>
      <span class="desk-tile-title">Добавить ярлык</span>
    </button>`;

  grid.querySelectorAll('[data-desk-add]').forEach((button) => {
    button.addEventListener('click', () => openDeskPrefs());
  });

  grid.querySelectorAll('[data-desk]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = DESK_SHORTCUTS.find((row) => row.key === button.dataset.desk);
      if (!item) return;

      if (item.key === 'ai') { aiOpen(); return; }
      if (item.key === 'apps') { openAppsPanel(); return; }
      if (item.target) { deskOpen(item.target); return; }

      if (item.filter) {
        state.orderFilter.status = item.filter;
        deskOpen('orders');
        renderStatusChips();
        loadOrders();
        return;
      }

      if (item.key === 'orders') {
        state.orderFilter.status = '';
        deskOpen('orders');
        renderStatusChips();
        loadOrders();
        return;
      }

      deskOpen(item.key);
    });
  });
}

/* --------------------------------------------------------------------------
   Программы компьютера: через локального помощника
   -------------------------------------------------------------------------- */

const LOCAL_AGENT = 'http://127.0.0.1:8787';

async function agentRequest(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(LOCAL_AGENT + path, {
      ...options,
      signal: controller.signal,
      cache: 'no-store'
    });

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function openAppsPanel() {
  const modal = $('#appsModal');
  if (!modal) return;

  modal.classList.add('open');
  await renderAppsList();
}

async function renderAppsList() {
  const host = $('#appsList');
  const help = $('#appsHelp');
  if (!host) return;

  host.innerHTML = '<div class="spinner">Смотрю программы…</div>';

  try {
    const data = await agentRequest('/apps');
    const apps = data.apps || [];

    if (!apps.length) {
      host.innerHTML = '<div class="empty-line">Помощник запущен, но список программ пуст</div>';
      if (help) help.classList.add('hidden');
      return;
    }

    if (help) help.classList.add('hidden');

    host.innerHTML = `<div class="apps-grid">${apps.map((app) => `
      <button class="apps-item" data-app="${esc(app.id)}">
        <span class="apps-icon">${esc(app.icon || '▶️')}</span>
        <span>${esc(app.title)}</span>
      </button>`).join('')}</div>`;

    host.querySelectorAll('[data-app]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const result = await agentRequest('/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: button.dataset.app })
          });

          toast(result.title ? 'Открываю: ' + result.title : 'Готово');
        } catch (error) {
          toast('Не получилось запустить');
        }
      });
    });
  } catch (error) {
    host.innerHTML = '<div class="empty-line">Помощник не запущен на этом компьютере</div>';
    if (help) help.classList.remove('hidden');
  }
}
/** Окно выбора ярлыков. */
function openDeskPrefs() {
  const host = $('#deskPrefsList');
  const list = currentDeskItems();

  if (!host) return;

  host.innerHTML = DESK_SHORTCUTS.map((item) => {
    const disabled = item.key === 'users' && state.user && state.user.role !== 'admin';

    return `<label class="nav-pref ${disabled ? 'is-disabled' : ''}">
      <input type="checkbox" value="${esc(item.key)}" ${list.includes(item.key) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span>${item.icon} ${esc(item.title)}</span>
    </label>`;
  }).join('');

  $('#deskPrefsModal').classList.add('open');
}

async function saveDeskPrefs() {
  const items = $$('#deskPrefsList input:checked').map((input) => input.value);

  try {
    await api('/api/me/desk', { method: 'PUT', body: { items } });

    if (state.user) state.user.desk_items = items;

    $('#deskPrefsModal').classList.remove('open');

    await renderDeskShortcuts();
    toast('Ярлыки обновлены');
  } catch (error) {
    toast(error.message);
  }
}

/* --------------------------------------------------------------------------
   Рабочий стол: плитки и быстрый поиск
   -------------------------------------------------------------------------- */

/* Закреплённые разделы слева — как док в системе */
const DESK_DOCK = [
  { name: 'orders', icon: '📋', title: 'Заказы' },
  { name: 'stock', icon: '📦', title: 'Склад' },
  { name: 'tds', icon: '📄', title: 'ТДС' },
  { name: 'norms', icon: '⚖️', title: 'Нормы' },
  { name: 'refs', icon: '📚', title: 'Справочники' },
  { name: 'chat', icon: '💬', title: 'Обсуждения' }
];

function renderDeskDock() {
  const dock = $('#deskDock');
  if (!dock) return;

  const host = $('#deskWindows');

  dock.innerHTML = DESK_DOCK.map((item) => {
    const open = host && host.querySelector('[data-window="' + item.name + '"]');

    return `<button class="dock-btn ${open ? 'is-open' : ''}" data-dock="${esc(item.name)}" title="${esc(item.title)}">
      <span class="dock-icon">${item.icon}</span>
      ${open ? '<span class="dock-dot"></span>' : ''}
    </button>`;
  }).join('') + `
    <span class="dock-sep"></span>
    <button class="dock-btn" data-dock="new" title="Новый заказ">➕</button>
    <button class="dock-btn" data-dock="ai" title="Помощник">🤖</button>
    <button class="dock-btn" data-dock="desk" title="Свернуть всё">🗗</button>
  `;

  dock.querySelectorAll('[data-dock]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.dock;

      if (target === 'ai') { aiOpen(); return; }
      if (target === 'new') { showView('new'); return; }

      if (target === 'desk') {
        const list = $$('#deskWindows .desk-window');
        list.forEach((win) => minimizeDeskWindow(win.dataset.window));
        return;
      }

      deskOpen(target);
    });
  });
}

function deskTile(options) {
  const count = options.count === null || options.count === undefined
    ? ''
    : `<span class="desk-tile-count">${esc(String(options.count))}</span>`;

  const note = options.note ? `<span class="desk-tile-note">${esc(options.note)}</span>` : '';

  return `<button class="desk-tile" data-desk="${esc(options.desk || '')}">
    <span class="desk-tile-icon">${options.icon || ''}</span>
    <span class="desk-tile-title">${esc(options.title)}</span>
    ${note}
    ${count}
  </button>`;
}

async function loadDesk() {
  const grid = $('#deskGrid');
  if (!grid) return;

  const user = state.user || {};
  const hello = $('#deskHello');

  if (hello) {
    const hour = new Date().getHours();
    const part = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
    // В базе «Фамилия Имя» — здороваемся по имени
    const parts = String(user.full_name || '').trim().split(/\s+/).filter(Boolean);
    const name = parts.length > 1 ? parts[1] : parts[0];
    hello.textContent = name ? `${part}, ${name}` : 'Рабочий стол';
  }

  const clock = $('#deskClock');
  if (clock) {
    const now = new Date();
    clock.textContent = now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
      + ', ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }


  renderDeskDock();
  await renderDeskShortcuts();
}

/** Поиск с рабочего стола: заказы и материалы. */
async function deskSearchRun(term) {
  const panel = $('#deskSearchResults');
  if (!panel) return;

  const q = String(term || '').trim();

  if (q.length < 2) {
    panel.classList.add('hidden');
    return;
  }

  try {
    const [foundOrders, foundMaterials] = await Promise.all([
      api('/api/orders?q=' + encodeURIComponent(q)).catch(() => ({ orders: [] })),
      api('/api/materials?q=' + encodeURIComponent(q)).catch(() => ({ materials: [] }))
    ]);

    const orders = (foundOrders.orders || []).slice(0, 5);
    const materials = (foundMaterials.materials || []).slice(0, 5);

    if (!orders.length && !materials.length) {
      panel.innerHTML = '<div class="row" style="cursor:default">Ничего не найдено</div>';
      panel.classList.remove('hidden');
      return;
    }

    panel.innerHTML = orders.map((order) => `
      <div class="row" data-desk-order="${esc(order.id)}">
        <span class="code">${esc(order.number)}</span>
        <span class="name">${esc(order.plate)} · ${esc([order.make, order.model].filter(Boolean).join(' '))}</span>
      </div>`).join('')
      + materials.map((item) => `
      <div class="row" data-desk-material="${esc(item.code)}">
        <span class="code">${esc(item.code)}</span>
        <span class="name">${esc(item.name)} · ${qty(item.stock_left || 0)} ${esc(item.unit)}</span>
      </div>`).join('');

    panel.classList.remove('hidden');

    panel.querySelectorAll('[data-desk-order]').forEach((row) => {
      row.addEventListener('click', () => {
        panel.classList.add('hidden');
        openOrder(row.dataset.deskOrder);
      });
    });

    panel.querySelectorAll('[data-desk-material]').forEach((row) => {
      row.addEventListener('click', () => {
        panel.classList.add('hidden');
        showView('stock');
      });
    });
  } catch (error) {
    panel.classList.add('hidden');
  }
}

/* --------------------------------------------------------------------------
   Вкладки открытых заказов
   -------------------------------------------------------------------------- */

function renderOrderTabs() {
  const bar = $('#orderTabs');
  if (!bar) return;

  const list = state.openOrders || [];

  if (!list.length) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }

  bar.classList.remove('hidden');

  bar.innerHTML = list.map((item) => `
    <button class="order-tab-chip ${Number(item.id) === Number(state.order && state.order.id) ? 'active' : ''}" data-order-tab="${esc(item.id)}">
      <span>${esc(item.number)}</span>
      <span class="order-tab-plate">${esc(item.plate)}</span>
      <span class="order-tab-x" data-order-tab-close="${esc(item.id)}">×</span>
    </button>`).join('');

  bar.querySelectorAll('[data-order-tab]').forEach((button) => {
    button.addEventListener('click', (event) => {
      if (event.target.dataset.orderTabClose) return;
      openOrder(button.dataset.orderTab);
    });
  });

  bar.querySelectorAll('[data-order-tab-close]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();

      const id = button.dataset.orderTabClose;
      state.openOrders = (state.openOrders || []).filter((item) => String(item.id) !== String(id));

      if (state.order && String(state.order.id) === String(id)) {
        const next = (state.openOrders || [])[0];
        if (next) openOrder(next.id); else showView('orders');
        } else {

      }
    });
  });
}

function rememberOrder(order) {
  if (!order || !order.id) return;

  state.openOrders = state.openOrders || [];

  if (!state.openOrders.some((item) => String(item.id) === String(order.id))) {
    state.openOrders.push({ id: order.id, number: order.number, plate: order.plate });
  }

  // Больше пяти вкладок не держим
  while (state.openOrders.length > 5) state.openOrders.shift();
}

/* --------------------------------------------------------------------------
   Режим «рабочий стол»: разделы открываются окнами, которые можно
   свернуть, закрыть и перетащить. Классический режим не затрагивается.
   -------------------------------------------------------------------------- */

const UI_MODE_KEY = 'paintShopUiMode';

/** Пиктограммы разделов — для колонки открытых вкладок. */
const WINDOW_ICONS = {
  orders: '📋',
  order: '🧾',
  new: '➕',
  chat: '💬',
  report: '📈',
  clients: '👥',
  stock: '📦',
  tds: '📄',
  norms: '⚖️',
  refs: '📚',
  users: '🧑‍🔧',
  tasks: '🗒️',
  home: '🏠'
};

const WINDOW_TITLES = {
  orders: 'Заказы',
  tasks: 'Задачи',
  order: 'Заказ',
  new: 'Новый заказ',
  chat: 'Обсуждения',
  report: 'Отчёт',
  clients: 'Клиенты',
  stock: 'Склад',
  tds: 'ТДС и паспорта',
  norms: 'Нормы списания',
  refs: 'Справочники',
  users: 'Сотрудники'
};

/** Часы в шапке: время видно и в полноэкранном режиме. */
function tickClock() {
  const host = $('#topClock');
  if (!host) return;

  const now = new Date();
  host.textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  host.title = now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', weekday: 'short' });
}

function startClock() {
  tickClock();
  setInterval(tickClock, 15000);
}

/** Переключатель режима в шапке: обычный / рабочий стол. */
function renderModeSwitch() {
  const buttons = $$('#btnModeSwitch .mode-seg');
  const mode = uiMode();

  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
}

function setUiMode(mode) {
  localStorage.setItem(UI_MODE_KEY, mode);
  applyUiMode();
}

/* --------------------------------------------------------------------------
   Пункты шапки: у каждого пользователя свои
   -------------------------------------------------------------------------- */

const NAV_ITEMS = [
  { view: 'orders', title: 'Заказы' },
  { view: 'chat', title: 'Обсуждения' },
  { view: 'tasks', title: 'Задачи' },
  { view: 'stock', title: 'Склад' },
  { view: 'tds', title: 'ТДС и паспорта' },
  { view: 'norms', title: 'Нормы списания' },
  { view: 'report', title: 'Отчёт' },
  { view: 'clients', title: 'Клиенты' },
  { view: 'refs', title: 'Справочники' },
  { view: 'users', title: 'Сотрудники' }
];

/** Набор по умолчанию зависит от роли. */
function defaultNavItems() {
  const role = (state.user && state.user.role) || 'painter';

  if (role === 'admin' || role === 'manager') return ['orders', 'chat', 'tasks', 'stock'];
  if (role === 'storekeeper' || role === 'store') return ['stock', 'tasks', 'chat', 'tds'];
  if (role === 'master') return ['orders', 'chat', 'tds', 'tasks'];

  return ['orders', 'chat', 'tds'];
}

function currentNavItems() {
  const saved = state.user && state.user.nav_items;
  if (Array.isArray(saved) && saved.length) return saved;

  return defaultNavItems();
}

/** Выбранные пункты — в шапку, остальные — в меню «Ещё». */
function applyNavPrefs(items) {
  const list = Array.isArray(items) && items.length ? items : currentNavItems();
  const extra = $('#navExtra');
  const menu = $('#moreMenu');

  if (!extra || !menu) return;

  NAV_ITEMS.forEach((item) => {
    const button = document.querySelector('.nav-btn[data-view="' + item.view + '"]');
    if (!button) return;

    if (list.includes(item.view)) {
      button.classList.add('nav-btn-header');
      button.classList.remove('menu-item');
      extra.appendChild(button);
    } else {
      button.classList.remove('nav-btn-header');
      button.classList.add('menu-item');
      menu.appendChild(button);
    }
  });

  const more = $('.nav-more');
  if (more) more.classList.toggle('hidden', !menu.children.length);
}

function openNavPrefs() {
  const host = $('#navPrefsList');
  const list = currentNavItems();

  if (!host) return;

  host.innerHTML = NAV_ITEMS.map((item) => {
    const disabled = item.view === 'users' && state.user && state.user.role !== 'admin';

    return `<label class="nav-pref ${disabled ? 'is-disabled' : ''}">
      <input type="checkbox" value="${esc(item.view)}" ${list.includes(item.view) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span>${esc(item.title)}</span>
    </label>`;
  }).join('');

  $('#navPrefsModal').classList.add('open');
}

async function saveNavPrefs() {
  const items = $$('#navPrefsList input:checked').map((input) => input.value);

  try {
    await api('/api/me/nav', { method: 'PUT', body: { items } });

    if (state.user) state.user.nav_items = items;

    applyNavPrefs(items);
    $('#navPrefsModal').classList.remove('open');
    toast('Шапка настроена');
  } catch (error) {
    toast(error.message);
  }
}
function uiMode() {
  return localStorage.getItem(UI_MODE_KEY) === 'desk' ? 'desk' : 'classic';
}

function uiModeLabel() {
  const button = $('#btnUiMode');
  if (!button) return;

  button.textContent = uiMode() === 'desk' ? 'Режим: рабочий стол' : 'Режим: обычный';
}

function applyUiMode() {
  const desk = uiMode() === 'desk';

  document.body.classList.toggle('ui-desk', desk);

  // Кнопка «Стол» нужна только в режиме рабочего стола
  document.querySelectorAll('[data-view="home"]').forEach((button) => {
    button.classList.toggle('hidden', !desk);
  });

  const layer = $('#deskLayer');
  const taskbar = $('#deskTaskbar');

  if (desk) {
    if (layer) layer.classList.remove('hidden');
    if (taskbar) taskbar.classList.add('hidden');

    sizeDeskLayer();
    showDeskHome();
  } else {
    closeAllWindows();

    if (layer) layer.classList.add('hidden');
    if (taskbar) taskbar.classList.add('hidden');

    showView('orders');
  }

  uiModeLabel();
  renderModeSwitch();
}

function toggleUiMode() {
  localStorage.setItem(UI_MODE_KEY, uiMode() === 'desk' ? 'classic' : 'desk');
  applyUiMode();
}

/** Стол как фон: показываем только домашнюю вьюху. */
function showDeskHome() {
  const main = document.querySelector('main.main');

  // Скрываем только то, что лежит на странице, — содержимое окон не трогаем
  $$('.view').forEach((view) => {
    if (main && view.parentElement === main) view.classList.add('hidden');
  });

  const home = $('#view-home');
  if (home) home.classList.remove('hidden');

  state.view = 'home';
  if (typeof loadDesk === 'function') loadDesk();
}

function windowTitle(name) {
  if (name === 'order' && state.order) return `Заказ ${state.order.number}`;
  return WINDOW_TITLES[name] || 'Раздел';
}

let windowZ = 100;

function openDeskWindow(name) {
  const host = $('#deskWindows');
  if (!host) return;

  const view = document.getElementById('view-' + name);
  if (!view) return;

  let win = host.querySelector('[data-window="' + name + '"]');

  if (!win) {
    win = document.createElement('div');
    win.className = 'desk-window';
    win.dataset.window = name;

    win.innerHTML = `
      <div class="desk-window-head">
        <span class="desk-window-icon"></span>
        <span class="desk-window-title"></span>
        <span class="desk-window-btns">
          <button class="desk-win-btn" data-win-max title="Развернуть">⤢</button>
          <button class="desk-win-btn" data-win-min title="Свернуть">–</button>
          <button class="desk-win-btn" data-win-close title="Закрыть">×</button>
        </span>
      </div>
      <div class="desk-window-body"></div>
    `;

    win.querySelector('.desk-window-body').appendChild(view);
    view.classList.remove('hidden');

    win.querySelector('[data-win-close]').addEventListener('click', () => closeDeskWindow(name));
    win.querySelector('[data-win-max]').addEventListener('click', () => toggleDeskMaximize(name));
    win.querySelector('[data-win-min]').addEventListener('click', () => minimizeDeskWindow(name));
    win.querySelector('.desk-window-head').addEventListener('pointerdown', (event) => startWindowDrag(event, win));

    host.appendChild(win);
  } else {
    win.querySelector('.desk-window-body').appendChild(view);
    view.classList.remove('hidden');
  }

  focusDeskWindow(name);
  applyDeskLayout();
  refreshWindowTitles();

  if (name === 'orders') loadOrders();
  if (name === 'chat') openGeneralChat();
  if (name === 'report') loadReport();
  if (name === 'refs') loadRefs();
  if (name === 'clients') loadClients();
  if (name === 'stock') loadWarehouse();
  if (name === 'tds') loadTdsView();
  if (name === 'norms') loadNormsView();
  if (name === 'users') loadUsers();
}

/** Какое окно сейчас активно. */
function activeDeskWindow() {
  const host = $('#deskWindows');
  if (!host) return null;

  return host.querySelector('.desk-window.active') || null;
}

/** Вернуть раздел на страницу, если он лежит в каком-то окне. */
function detachViewFromWindows(view) {
  if (!view) return;

  const main = document.querySelector('main.main');
  if (!main) return;

  if (view.parentElement && view.parentElement !== main) {
    main.appendChild(view);
    view.classList.add('hidden');
  }
}

/**
 * Переход внутри активного окна: заказ, карточка, ТДС — всё остаётся
 * в том же окне. Новые окна открывает только рабочий стол.
 */
function deskNavigate(name) {
  const win = activeDeskWindow();

  if (!win) {
    openDeskWindow(name);
    return;
  }

  const view = document.getElementById('view-' + name);
  if (!view) return;

  const body = win.querySelector('.desk-window-body');
  if (!body) return;

  // Убираем прежнее содержимое окна на страницу
  [...body.querySelectorAll('.view')].forEach((old) => {
    if (old !== view) detachViewFromWindows(old);
  });

  // Если раздел уже открыт в другом окне — забираем его сюда
  const other = win.parentElement.querySelector('[data-window]');
  win.parentElement.querySelectorAll('.desk-window').forEach((item) => {
    if (item === win) return;
    if (item.querySelector('#view-' + name)) {
      detachViewFromWindows(view);
    }
  });

  body.appendChild(view);
  view.classList.remove('hidden');

  win.dataset.view = name;
  win.dataset.title = windowTitle(name);

  focusDeskWindow(win.dataset.window);
  refreshWindowTitles();
  state.view = name;

  if (name === 'orders') loadOrders();
  if (name === 'chat') openGeneralChat();
  if (name === 'report') loadReport();
  if (name === 'refs') loadRefs();
  if (name === 'clients') loadClients();
  if (name === 'stock') loadWarehouse();
  if (name === 'tds') loadTdsView();
  if (name === 'norms') loadNormsView();
  if (name === 'users') loadUsers();
  if (name === 'tasks') loadTasks();
}

/** Открыть раздел отдельным окном (или обычным экраном вне режима стола). */
function deskOpen(name) {
  if (uiMode() === 'desk') {
    openDeskWindow(name);
    return;
  }

  showView(name);
}
/** «Стол»: сворачиваем окна, содержимое остаётся на месте. */
function minimizeAllDeskWindows() {
  const host = $('#deskWindows');
  if (host) host.querySelectorAll('.desk-window').forEach((win) => win.classList.add('minimized'));
  applyDeskLayout();

  showDeskHome();
  renderDeskTaskbar();
}

function focusDeskWindow(name) {
  const host = $('#deskWindows');
  if (!host) return;

  const win = host.querySelector('[data-window="' + name + '"]');
  if (!win) return;

  windowZ += 1;
  win.style.zIndex = String(windowZ);

  // Окна не мешают друг другу: все остаются на столе.
  // Развёрнутое окно снимаем с разворота, иначе новые окна будут скрыты.
  host.querySelectorAll('.desk-window').forEach((item) => {
    item.classList.remove('active');
    if (item !== win) item.classList.remove('is-max');
  });

  win.classList.remove('minimized');
  win.classList.add('active');

  applyDeskLayout();

  renderDeskTaskbar();
}

/** Раскладываем окна мозаикой: 1 — на всё, 2 — колонками, до 4 — сеткой. */
/** Слой окон строго под шапкой: шапка — панель задач. */
function sizeDeskLayer() {
  const layer = $('#deskLayer');
  if (!layer) return;

  const topbar = document.querySelector('.topbar');
  const height = topbar ? Math.round(topbar.getBoundingClientRect().height) : 56;

  layer.style.top = height + 'px';
}

function applyDeskLayout() {
  const host = $('#deskWindows');
  if (!host) return;

  const visible = [...host.querySelectorAll('.desk-window')].filter((win) => !win.classList.contains('minimized'));
  const maximized = visible.some((win) => win.classList.contains('is-max'));

  host.classList.remove('count-0', 'count-1', 'count-2', 'count-3', 'count-4', 'count-5', 'count-6');
  host.classList.toggle('has-max', maximized);

  const many = Math.min(6, Math.max(1, visible.length));
  host.classList.add('count-' + (visible.length ? many : 0));

  sizeDeskLayer();
}

/** Развернуть окно на всю область или вернуть в мозаику. */
function toggleDeskMaximize(name) {
  const host = $('#deskWindows');
  if (!host) return;

  const win = host.querySelector('[data-window="' + name + '"]');
  if (!win) return;

  const wasMax = win.classList.contains('is-max');

  host.querySelectorAll('.desk-window').forEach((item) => item.classList.remove('is-max'));

  if (!wasMax) {
    win.classList.add('is-max');
    win.classList.remove('minimized');
    host.querySelectorAll('.desk-window').forEach((item) => item.classList.remove('active'));
    win.classList.add('active');
  }

  applyDeskLayout();
  renderDeskTaskbar();
}

function minimizeDeskWindow(name) {
  const host = $('#deskWindows');
  if (!host) return;

  const win = host.querySelector('[data-window="' + name + '"]');
  if (win) win.classList.add('minimized');

  renderDeskTaskbar();
}

/** Вернуть раздел в общий контейнер — как в обычном режиме. */
function detachWindowView(name) {
  const view = document.getElementById('view-' + name);
  const main = document.querySelector('main.main');

  if (view && main && view.parentElement !== main) {
    main.appendChild(view);
    view.classList.add('hidden');
  }
}

function closeDeskWindow(name) {
  const host = $('#deskWindows');
  if (!host) return;

  const win = host.querySelector('[data-window="' + name + '"]');

  if (win) {
    win.querySelectorAll('.view').forEach((view) => detachViewFromWindows(view));
    win.remove();
  }

  renderDeskTaskbar();
  applyDeskLayout();
  showDeskHome();
}

function closeAllWindows() {
  const host = $('#deskWindows');
  if (!host) return;

  host.querySelectorAll('.desk-window').forEach((win) => {
    detachWindowView(win.dataset.window);
    win.remove();
  });

  renderDeskTaskbar();
}

function refreshWindowTitles() {
  const host = $('#deskWindows');
  if (!host) return;

  host.querySelectorAll('.desk-window').forEach((win) => {
    const title = win.querySelector('.desk-window-title');
    const icon = win.querySelector('.desk-window-icon');

    if (title) title.textContent = win.dataset.title || windowTitle(win.dataset.window);
    if (icon) icon.textContent = WINDOW_ICONS[win.dataset.view || win.dataset.window] || '▫️';
  });

  renderDeskTaskbar();
}

/** Диспетчер окон в шапке: список открытых разделов. */
function renderWinSwitcher() {
  const rail = $('#winRail');
  if (!rail) return;

  const host = $('#deskWindows');
  const wins = host ? [...host.querySelectorAll('.desk-window')] : [];

  if (!wins.length || uiMode() !== 'desk') {
    rail.classList.add('hidden');
    rail.innerHTML = '';
    return;
  }

  rail.classList.remove('hidden');

  const items = wins.map((win) => {
    const active = win.classList.contains('active') && !win.classList.contains('minimized');
    const label = win.dataset.title || windowTitle(win.dataset.window);
    const icon = WINDOW_ICONS[win.dataset.view || win.dataset.window] || '▫️';

    return `<button class="rail-item ${active ? 'active' : ''}" data-rail="${esc(win.dataset.window)}" title="${esc(label)}">
      <span class="rail-icon">${icon}</span>
      <span class="rail-label">${esc(label)}</span>
      <span class="rail-x" data-rail-close="${esc(win.dataset.window)}">×</span>
    </button>`;
  }).join('');

  rail.innerHTML = `<button class="rail-item rail-home" data-rail-home="1" title="Свернуть всё и вернуться к столу">
    <span class="rail-icon">🏠</span>
    <span class="rail-label">Стол</span>
  </button>` + items;

  rail.querySelectorAll('[data-rail-home]').forEach((button) => {
    button.addEventListener('click', () => minimizeAllDeskWindows());
  });

  rail.querySelectorAll('[data-rail]').forEach((button) => {
    button.addEventListener('click', (event) => {
      if (event.target.dataset.railClose) return;

      const name = button.dataset.rail;
      const win = host.querySelector('[data-window="' + name + '"]');
      if (!win) return;

      if (win.classList.contains('active') && !win.classList.contains('minimized')) {
        minimizeDeskWindow(name);
        showDeskHome();
      } else {
        focusDeskWindow(name);
        applyDeskLayout();
      }
    });
  });

  rail.querySelectorAll('[data-rail-close]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      closeDeskWindow(button.dataset.railClose);
    });
  });
}
function renderDeskTaskbar() {
  renderDeskDock();
  renderWinSwitcher();

  const bar = $('#deskTaskbar');
  if (!bar) return;

  const host = $('#deskWindows');
  const wins = host ? [...host.querySelectorAll('.desk-window')] : [];

  if (!wins.length) {
    bar.innerHTML = '<span class="desk-taskbar-hint">Открывайте разделы с рабочего стола</span>';
    return;
  }

  bar.innerHTML = wins.map((win) => {
    const name = win.dataset.window;
    const active = win.classList.contains('active') && !win.classList.contains('minimized');

    const label = win.dataset.title || windowTitle(name);

    return `<button class="desk-task ${active ? 'active' : ''}" data-task="${esc(name)}">${esc(label)}</button>`;
  }).join('');

  bar.querySelectorAll('[data-task]').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.task;
      const win = host.querySelector('[data-window="' + name + '"]');

      if (!win) return;

      if (win.classList.contains('active') && !win.classList.contains('minimized')) {
        minimizeDeskWindow(name);
      } else {
        focusDeskWindow(name);
      }
    });
  });
}

/** Перетаскивание окна за заголовок. */
function startWindowDrag(event, win) {
  if (event.target.closest('button')) return;

  const startX = event.clientX;
  const startY = event.clientY;
  const left = parseFloat(win.style.left || '0');
  const top = parseFloat(win.style.top || '0');

  const move = (e) => {
    win.style.left = Math.max(0, left + e.clientX - startX) + 'px';
    win.style.top = Math.max(0, top + e.clientY - startY) + 'px';
  };

  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

/* --------------------------------------------------------------------------
   Задачи: общая доска цеха — дела с датами и напоминаниями
   -------------------------------------------------------------------------- */

let tasksFilter = 'open';

/** Подпись срока: «сегодня», «завтра», дата или «просрочено». */
function taskDateLabel(date) {
  if (!date) return { text: 'без срока', cls: '' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(date + 'T00:00:00');
  const diff = Math.round((due - today) / 86400000);
  const pretty = due.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });

  if (diff < 0) return { text: pretty + ' · просрочено', cls: 'late' };
  if (diff === 0) return { text: 'сегодня', cls: 'today' };
  if (diff === 1) return { text: 'завтра', cls: 'soon' };
  if (diff <= 7) return { text: pretty, cls: 'soon' };

  return { text: pretty, cls: '' };
}

async function loadTasks() {
  const host = $('#taskList');
  if (!host) return;

  host.innerHTML = '<div class="spinner">Загрузка…</div>';

  try {
    const data = await api('/api/tasks?status=' + encodeURIComponent(tasksFilter));
    const tasks = data.tasks || [];

    const badge = $('#tasksBadge');

    if (badge) {
      const urgent = (data.counts.overdue || 0) + (data.counts.today || 0);
      badge.textContent = urgent ? String(urgent) : '';
      badge.classList.toggle('hidden', !urgent);
    }

    if (!tasks.length) {
      host.innerHTML = '<div class="empty-line">'
        + (tasksFilter === 'done' ? 'Выполненных задач нет' : 'Задач пока нет — добавьте первую сверху')
        + '</div>';
      return;
    }

    const me = state.user || {};
    const canRemove = (task) => me.role === 'admin' || Number(task.owner_id) === Number(me.id);

    host.innerHTML = tasks.map((task) => {
      const label = taskDateLabel(task.due_date);

      return `
        <div class="task-row ${task.done ? 'is-done' : ''}" data-task="${task.id}">
          <button class="task-check ${task.done ? 'checked' : ''}" data-task-toggle="${task.id}" title="Готово">✓</button>
          <div class="task-main">
            <div class="task-title">${esc(task.title)}</div>
            <div class="task-meta">
              <span class="task-date ${label.cls}">${esc(label.text)}</span>
              ${task.priority === 2 ? '<span class="task-prio">важная</span>' : ''}
              ${task.order_id ? `<button class="task-link" data-task-order="${task.order_id}">к заказу</button>` : ''}
              ${task.owner ? `<span class="muted">поставил: ${esc(task.owner.split(' ')[0])}</span>` : ''}
            </div>
          </div>
          <input type="date" class="task-due" value="${task.due_date || ''}" data-task-due="${task.id}" title="Срок">
          ${canRemove(task) ? `<button class="row-del" data-task-del="${task.id}" title="Снять задачу">×</button>` : ''}
        </div>`;
    }).join('');

    host.querySelectorAll('[data-task-toggle]').forEach((button) => {
      button.addEventListener('click', async () => {
        const row = button.closest('.task-row');
        const isDone = row.classList.contains('is-done');

        await api('/api/tasks/' + button.dataset.taskToggle, { method: 'PATCH', body: { done: !isDone } });
        loadTasks();
        loadDesk();
      });
    });

    host.querySelectorAll('[data-task-due]').forEach((input) => {
      input.addEventListener('change', async () => {
        await api('/api/tasks/' + input.dataset.taskDue, {
          method: 'PATCH',
          body: { due_date: input.value || null }
        });

        loadTasks();
        loadDesk();
      });
    });

    host.querySelectorAll('[data-task-order]').forEach((button) => {
      button.addEventListener('click', () => openOrder(button.dataset.taskOrder));
    });

    host.querySelectorAll('[data-task-del]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!confirm('Удалить задачу?')) return;

        await api('/api/tasks/' + button.dataset.taskDel, { method: 'DELETE' });
        loadTasks();
        loadDesk();
      });
    });
  } catch (error) {
    host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
  }
}

async function addTask() {
  const title = $('#taskTitle').value.trim();
  const due = $('#taskDue').value;
  const priority = Number($('#taskPriority').value) || 1;

  if (!title) return;

  try {
    await api('/api/tasks', { method: 'POST', body: { title, due_date: due || null, priority } });

    $('#taskTitle').value = '';
    $('#taskDue').value = '';

    await loadTasks();
    await loadDesk();
  } catch (error) {
    toast(error.message);
  }
}

async function openOrder(id) {
    try {
      const data = await api('/api/orders/' + id);
      state.order = data.order;

      showView('order');
      refreshWindowTitles();
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
      // Мастер сам берёт принятый заказ в работу
      if (order.status === 'accepted') {
        buttons.push({ status: 'in_work', label: 'Принял', cls: 'btn-primary' });
      }
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
            <td data-label="Работа">${esc(row.name)}${row.parts ? `<span class="muted"> · ${qty(row.parts)} дет.</span>` : ''}</td>
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
      <div class="order-bar">
        <div class="order-bar-main">
          <span class="order-bar-num">Заказ № ${esc(order.number)}</span>
          <span class="status-pill status-${esc(order.status)}" title="${esc(STATUS_HINT[order.status] || '')}">${esc(STATUS[order.status] || order.status)}</span>
          <span class="order-bar-sub">
            ${esc(order.plate)} · ${esc([order.make, order.model].filter(Boolean).join(' ') || 'марка не указана')}${order.color ? ' · ' + esc(order.color) : ''}
          </span>
        </div>

        <div class="order-bar-actions">
          ${isManager() ? '<button class="btn btn-outline btn-sm" id="btnEditOrder">Изменить</button>' : ''}
          ${actionButtons.replaceAll('class="btn ', 'class="btn btn-sm ')}
          <button class="btn btn-outline btn-sm" id="btnPrint">Печать</button>
          <button class="btn btn-outline btn-sm" id="btnBack">← К списку</button>
        </div>
      </div>

      <div class="order-tabs" id="orderTabs">
        <button class="order-tab" data-otab="order">Заказ</button>
        <button class="order-tab" data-otab="inspection">Осмотр<span class="tab-count" id="tabInspectCount"></span></button>
        <button class="order-tab" data-otab="materials">Списание материала<span class="tab-count">${order.materials.length}</span></button>
        <button class="order-tab" data-otab="photos">Фото<span class="tab-count" id="tabPhotoCount"></span></button>
        <button class="order-tab" data-otab="history">История</button>
        <button class="order-tab" data-otab="chat">Обсуждение</button>
      </div>

      <section class="order-panel" data-panel="order">
      <div class="card">
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
      </section>

      <section class="order-panel hidden" data-panel="inspection">
        <div class="card">
          <div class="card-head">
            <h2>Акт осмотра при приёмке</h2>
            <span class="muted">${isManager() ? 'Нажмите на машине, чтобы отметить повреждение' : 'что зафиксировали при приёмке'}</span>
          </div>

          <div id="inspectionBox"></div>
        </div>
      </section>
      <section class="order-panel hidden" data-panel="materials">
      <div class="card material-workspace" id="materialWorkspace">
        <div class="card-head">
          <h2>Списание материала</h2>
          <span class="muted">что израсходовано на этот заказ</span>
          <button class="btn btn-outline btn-sm focus-btn" id="btnFocusMaterials" title="Развернуть на весь экран (F)">
            ⛶ На весь экран
          </button>
        </div>

        <button class="focus-exit hidden" id="btnFocusExit" title="Свернуть (Esc)">
          ✕ Свернуть
        </button>

        <div class="material-layout">
          <div class="material-entry">
            ${canEdit
              ? '<div class="add-box add-box--wide" id="addMaterialBox"></div>'
              : '<p class="help-line" style="margin:0">Заказ сдан — списание закрыто. Верните его в работу, чтобы изменить.</p>'}
          </div>

          <div class="material-list">
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
        </div>
      </div>
      </section>

      <section class="order-panel hidden" data-panel="photos">
      <div class="card">
        <div class="card-head">
          <h2>Фотографии</h2>
          <span class="muted">машина, повреждения, результат</span>
        </div>

        <div class="photo-grid" id="orderPhotos"><div class="spinner">Загрузка…</div></div>

        <div class="actions-row" style="margin-top:12px">
          <button class="btn btn-outline" id="btnOrderPhoto">Добавить фото</button>
          <input type="file" id="orderPhotoInput" accept="image/*" multiple hidden>
        </div>
      </div>
      </section>

      <section class="order-panel hidden" data-panel="history">
      <div class="card">
        <div class="card-head">
          <h2>История изменений</h2>
          <span class="muted">кто, когда и что менял</span>
        </div>
        <div id="orderHistory"><div class="spinner">Загрузка…</div></div>
      </div>
      </section>

      <section class="order-panel hidden" data-panel="chat">
      <div class="card">
        <div class="card-head">
          <h2>Обсуждение заказа</h2>
          <span class="muted">видно всем, кто работает с цехом</span>
        </div>

        <div class="chat-messages chat-messages--inline" id="orderChatMessages"></div>

        <form class="chat-form" id="orderChatForm" style="border:none;padding:10px 0 0">
          <input type="text" id="orderChatInput" placeholder="Написать по этому заказу…" autocomplete="off" maxlength="2000">
          <button type="button" class="btn btn-outline attach-btn" id="btnOrderChatPhoto" title="Прикрепить фото" aria-label="Прикрепить фото">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 11.5l-8.6 8.6a5 5 0 01-7.1-7.1l8.6-8.6a3.3 3.3 0 014.7 4.7l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9"/>
            </svg>
          </button>
          <button type="submit" class="btn btn-primary">Отправить</button>
          <input type="file" id="orderChatPhotoInput" accept="image/*" multiple hidden>
        </form>
      </div>
      </section>
    `;

    bindOrderEvents(order, canEdit, canEditPrices);
    renderInspection();
    selectOrderTab(state.orderTab || 'order');
    shieldInputs(host);
    loadOrderPhotos(order.id);
    loadHistory(order.id);
    openOrderChat(order);
  }

  /* ---- Акт осмотра -------------------------------------------------------- */

  const DAMAGE_TYPES = ['вмятина', 'царапина', 'скол', 'ржавчина', 'нет детали'];

  let damageType = 'вмятина';
  let inspectionTimer = null;

  function inspectionSvg(view, points, canEdit) {
    const isTop = view === 'top';

    // Оба вида горизонтальные и одного размера — смотрятся как чертёж
    const width = 420;
    const height = 180;

    const marks = points
      .map((point, index) => ({ point, index }))
      .filter((item) => item.point.view === view)
      .map((item) => `
        <g class="damage" transform="translate(${(item.point.x * width) / 100} ${(item.point.y * height) / 100})">
          <circle r="9"></circle>
          <text text-anchor="middle" dy="4">${item.index + 1}</text>
        </g>`).join('');

    /* Вид сверху: капот слева, багажник справа */
    const topView = `
      <g class="car-top">
        <!-- корпус -->
        <path class="car-body" d="M56 40 L364 40 C382 44 392 62 392 90 C392 118 382 136 364 140 L56 140 C38 136 28 118 28 90 C28 62 38 44 56 40 Z"></path>

        <!-- дуги колёс -->
        <path class="car-arch" d="M86 40 C94 33 110 33 118 40"></path>
        <path class="car-arch" d="M86 140 C94 147 110 147 118 140"></path>
        <path class="car-arch" d="M302 40 C310 33 326 33 334 40"></path>
        <path class="car-arch" d="M302 140 C310 147 326 147 334 140"></path>

        <!-- бамперы -->
        <path class="car-seam" d="M64 40 C54 56 50 72 50 90 C50 108 54 124 64 140"></path>
        <path class="car-seam" d="M356 40 C366 56 370 72 370 90 C370 108 366 124 356 140"></path>

        <!-- фары и фонари -->
        <rect class="car-lamp" x="34" y="46" width="16" height="11" rx="4"></rect>
        <rect class="car-lamp" x="34" y="123" width="16" height="11" rx="4"></rect>
        <rect class="car-lamp-rear" x="370" y="46" width="16" height="11" rx="4"></rect>
        <rect class="car-lamp-rear" x="370" y="123" width="16" height="11" rx="4"></rect>

        <!-- капот, лобовое, крыша, заднее стекло, багажник -->
        <path class="car-seam" d="M124 40 L124 140"></path>
        <path class="car-glass" d="M124 40 L158 48 L158 132 L124 140 Z"></path>
        <path class="car-seam" d="M158 48 L262 48 L262 132 L158 132 Z"></path>
        <path class="car-glass" d="M262 48 L296 40 L296 140 L262 132 Z"></path>
        <path class="car-seam" d="M296 40 L296 140"></path>

        <!-- зеркала -->
        <rect class="car-mirror" x="118" y="28" width="17" height="9" rx="4"></rect>
        <rect class="car-mirror" x="118" y="143" width="17" height="9" rx="4"></rect>

        <!-- зоны -->
        <rect class="zone" data-zone="передний бампер" x="28" y="40" width="42" height="100"></rect>
        <rect class="zone" data-zone="капот" x="70" y="40" width="54" height="100"></rect>
        <rect class="zone" data-zone="крыша" x="124" y="40" width="172" height="100"></rect>
        <rect class="zone" data-zone="багажник" x="296" y="40" width="60" height="100"></rect>
        <rect class="zone" data-zone="задний бампер" x="356" y="40" width="36" height="100"></rect>
      </g>`;

    /* Вид сбоку: перед слева */
    const sideView = `
      <g class="car-side">
        <!-- корпус -->
        <path class="car-body" d="M20 134 L20 118 C20 110 26 104 36 102 L96 96 C108 94 118 86 130 74 C143 60 160 52 178 51 L258 51 C280 51 296 59 308 72 L324 86 C332 92 342 96 352 97 L388 101 C398 103 402 110 402 118 L402 134 Z"></path>

        <defs>
          <clipPath id="sideBodyClip">
            <path d="M20 134 L20 118 C20 110 26 104 36 102 L96 96 C108 94 118 86 130 74 C143 60 160 52 178 51 L258 51 C280 51 296 59 308 72 L324 86 C332 92 342 96 352 97 L388 101 C398 103 402 110 402 118 L402 134 Z"></path>
          </clipPath>
        </defs>

        <!-- арки колёс -->
        <g clip-path="url(#sideBodyClip)">
          <circle class="car-arch-bg" cx="112" cy="134" r="32"></circle>
          <circle class="car-arch-bg" cx="316" cy="134" r="32"></circle>
        </g>

        <path class="car-arch" d="M80 134 A32 32 0 0 1 144 134"></path>
        <path class="car-arch" d="M284 134 A32 32 0 0 1 348 134"></path>

        <!-- колёса -->
        <circle class="car-tire" cx="112" cy="134" r="24"></circle>
        <circle class="car-rim" cx="112" cy="134" r="11"></circle>
        <circle class="car-tire" cx="316" cy="134" r="24"></circle>
        <circle class="car-rim" cx="316" cy="134" r="11"></circle>

        <!-- стёкла -->
        <path class="car-glass" d="M134 78 L170 58 L208 58 L208 80 Z"></path>
        <path class="car-glass" d="M218 58 L254 58 L288 80 L218 80 Z"></path>

        <!-- стойки, двери, ручки, зеркало -->
        <path class="car-seam" d="M210 58 L210 134"></path>
        <path class="car-seam" d="M130 80 L130 100"></path>
        <path class="car-seam" d="M292 80 L292 100"></path>
        <rect class="car-handle" x="148" y="94" width="20" height="6" rx="3"></rect>
        <rect class="car-handle" x="236" y="94" width="20" height="6" rx="3"></rect>
        <path class="car-mirror" d="M124 76 L140 74 L142 82 L126 83 Z"></path>

        <!-- фары и фонари -->
        <path class="car-lamp" d="M22 108 C28 105 35 104 42 104 L42 113 C35 113 28 114 22 117 Z"></path>
        <path class="car-lamp-rear" d="M384 104 C390 103 396 103 400 105 L400 116 C396 118 390 118 384 117 Z"></path>

        <!-- зоны -->
        <rect class="zone" data-zone="передний бампер" x="14" y="96" width="34" height="38"></rect>
        <rect class="zone" data-zone="капот" x="48" y="88" width="72" height="22"></rect>
        <rect class="zone" data-zone="передняя дверь" x="130" y="74" width="80" height="60"></rect>
        <rect class="zone" data-zone="задняя дверь" x="210" y="74" width="84" height="60"></rect>
        <rect class="zone" data-zone="крыша" x="176" y="51" width="82" height="27"></rect>
        <rect class="zone" data-zone="заднее крыло" x="294" y="74" width="92" height="30"></rect>
        <rect class="zone" data-zone="задний бампер" x="386" y="96" width="30" height="38"></rect>
      </g>`;

    return `
      <svg class="inspect-svg${canEdit ? ' editable' : ''}" data-inspect-view="${view}"
           viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        ${isTop ? topView : sideView}
        ${marks}
      </svg>`;
  }

  function renderInspection() {
    const host = $('#inspectionBox');
    if (!host || !state.order) return;

    const points = state.order.inspection || [];
    const canEdit = isManager();

    host.innerHTML = `
      ${canEdit ? `
        <div class="damage-palette">
          ${DAMAGE_TYPES.map((type) => `
            <button class="damage-type${type === damageType ? ' active' : ''}" data-damage-type="${type}">${type}</button>`).join('')}
        </div>` : ''}

      <div class="inspect-layout">
        <div class="inspect-scheme">
          ${inspectionSvg('side', points, canEdit)}
          <div class="inspect-hint">вид сбоку</div>
        </div>
        <div class="inspect-scheme">
          ${inspectionSvg('top', points, canEdit)}
          <div class="inspect-hint">вид сверху</div>
        </div>
      </div>

      <div class="damage-list">
        ${points.length
          ? points.map((point, index) => `
              <div class="damage-row">
                <span class="damage-num">${index + 1}</span>
                ${canEdit
                  ? `<select data-damage-change="${index}">
                       ${DAMAGE_TYPES.map((type) => `<option value="${type}"${type === point.type ? ' selected' : ''}>${type}</option>`).join('')}
                     </select>
                     <span class="damage-zone">${esc(point.zone || 'кузов')}</span>
                     <button class="row-del" data-damage-del="${index}" title="Убрать">×</button>`
                  : `<span>${esc(point.type)}${point.zone ? ' · ' + esc(point.zone) : ''}</span>`}
              </div>`).join('')
          : '<div class="empty-line">Повреждений не отмечено</div>'}
      </div>
    `;

    const badge = $('#tabInspectCount');
    if (badge) badge.textContent = points.length ? String(points.length) : '';

    if (!canEdit) return;

    host.querySelectorAll('[data-damage-type]').forEach((button) => {
      button.addEventListener('click', () => {
        damageType = button.dataset.damageType;
        renderInspection();
      });
    });

    host.querySelectorAll('.inspect-svg').forEach((svg) => {
      svg.addEventListener('click', (event) => {
        const box = svg.getBoundingClientRect();
        const x = Math.round(((event.clientX - box.left) / box.width) * 1000) / 10;
        const y = Math.round(((event.clientY - box.top) / box.height) * 1000) / 10;

        if (x < 0 || y < 0 || x > 100 || y > 100) return;

        const panel = event.target.closest ? event.target.closest('[data-zone]') : null;

        state.order.inspection = [...(state.order.inspection || []), {
          view: svg.dataset.inspectView,
          x,
          y,
          type: damageType,
          zone: panel ? panel.dataset.zone : '',
          note: ''
        }];

        renderInspection();
        saveInspection();
      });
    });

    host.querySelectorAll('[data-damage-change]').forEach((select) => {
      select.addEventListener('change', () => {
        const index = Number(select.dataset.damageChange);
        state.order.inspection[index].type = select.value;
        renderInspection();
        saveInspection();
      });
    });

    host.querySelectorAll('[data-damage-del]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.damageDel);
        state.order.inspection.splice(index, 1);
        renderInspection();
        saveInspection();
      });
    });
  }

  function saveInspection() {
    clearTimeout(inspectionTimer);

    inspectionTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/orders/${state.order.id}/inspection`, {
          method: 'PATCH',
          body: { inspection: state.order.inspection || [] }
        });

        state.order.inspection = data.order.inspection;
      } catch (error) {
        toast(error.message);
      }
    }, 350);
  }

  /** Вкладки внутри карточки заказа. */
  /* ------------------------------------------------------------------------
     Списание на весь экран: остаётся только рабочая область
     ------------------------------------------------------------------------ */

  function setFocusMode(on) {
    document.body.classList.toggle('focus-mode', Boolean(on));
    document.body.style.overflow = on ? 'hidden' : '';

    const exitButton = $('#btnFocusExit');
    if (exitButton) exitButton.classList.toggle('hidden', !on);
  }

  /** Вкладки внутри карточки заказа. */
  function selectOrderTab(name) {
    state.orderTab = name;

    if (name !== 'materials') setFocusMode(false);

    $$('.order-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.otab === name);
    });

    $$('.order-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.panel !== name);
    });
  }

  function materialRows(rows, canEdit) {
    if (!rows.length) {
      return '<tr><td colspan="5" class="empty-line">Пусто</td></tr>';
    }

    return rows.map((row) => `
      <tr data-mid="${row.id}">
        <td class="code-cell" data-label="Код">${esc(row.code)}</td>
        <td data-label="Наименование">${esc(row.name)}${row.aliases ? `<span class="muted"> · ${esc(row.aliases)}</span>` : ''}</td>
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
    if ($('#btnFocusMaterials')) $('#btnFocusMaterials').addEventListener('click', () => setFocusMode(true));
    if ($('#btnFocusExit')) $('#btnFocusExit').addEventListener('click', () => setFocusMode(false));

    $('#btnPrint').addEventListener('click', () => window.open('/print.html?id=' + order.id, '_blank'));

    $$('.order-tab').forEach((tab) => {
      tab.addEventListener('click', () => selectOrderTab(tab.dataset.otab));
    });

    bindOrderPhotos(order);

    bindPhotoButton($('#btnOrderChatPhoto'), $('#orderChatPhotoInput'),
      () => 'order:' + order.id,
      () => openOrderChat(order));

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

  /** Только дата: 2026-10-28T10:00 → 28.10.2026 */
  function dateOnly(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
  }

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

  /* ---- Фотографии --------------------------------------------------------- */

  const PHOTO_MAX_SIDE = 1600;
  const PHOTO_QUALITY = 0.82;

  /** Перед отправкой сжимаем снимок: с телефона он иначе весит 5–10 МБ. */
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));

      reader.onload = () => {
        const image = new Image();

        image.onerror = () => reject(new Error('Это не похоже на изображение'));

        image.onload = () => {
          let { width, height } = image;
          const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(width, height));

          width = Math.round(width * scale);
          height = Math.round(height * scale);

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const context = canvas.getContext('2d');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);

          resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
        };

        image.src = reader.result;
      };

      reader.readAsDataURL(file);
    });
  }

  async function uploadPhoto(file, target) {
    const image = await compressImage(file);
    const data = await api('/api/photos', { method: 'POST', body: { image, ...target } });
    return data.photo;
  }

  function openLightbox(src) {
    const previous = document.getElementById('lightbox');
    if (previous) previous.remove();

    const box = document.createElement('div');
    box.className = 'lightbox';
    box.id = 'lightbox';
    box.innerHTML = `<img src="${esc(src)}" alt="фотография">`;

    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  }

  /* ---- Фотографии заказа -------------------------------------------------- */

  async function loadOrderPhotos(orderId) {
    const host = $('#orderPhotos');
    if (!host) return;

    try {
      const data = await api('/api/orders/' + orderId + '/photos');
      renderOrderPhotos(data.photos);
    } catch (error) {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

  function renderOrderPhotos(photos) {
    const host = $('#orderPhotos');
    if (!host) return;

    if (!photos.length) {
      host.innerHTML = '<div class="empty-line">Фотографий пока нет</div>';
      return;
    }

    host.innerHTML = photos.map((photo) => `
      <figure class="photo">
        <img src="${esc(photo.url)}" alt="фотография заказа" loading="lazy">
        <figcaption>${esc(photo.user_name || '')}${photo.user_name ? ' · ' : ''}${dateText(photo.created_at)}</figcaption>
      </figure>`).join('');

    host.onclick = (event) => {
      const image = event.target.closest('img');
      if (image) openLightbox(image.src);
    };

    const counter = document.getElementById('tabPhotoCount');
    if (counter) counter.textContent = photos.length ? String(photos.length) : '';
  }

  /** Кнопка «Добавить фото» в карточке заказа. */
  function bindOrderPhotos(order) {
    const button = $('#btnOrderPhoto');
    const input = $('#orderPhotoInput');
    if (!button || !input) return;

    button.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.value = '';
      if (!files.length) return;

      toast('Загружаем фотографии…');

      for (const file of files) {
        try {
          await uploadPhoto(file, { orderId: order.id });
        } catch (error) {
          toast(error.message);
        }
      }

      await loadOrderPhotos(order.id);
      loadHistory(order.id);
    });
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
        ${message.photo_url ? `<img class="msg-photo" src="${esc(message.photo_url)}" alt="фотография">` : ''}
        ${message.body ? `<div class="msg-body">${esc(message.body)}</div>` : ''}
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

  async function sendChatPhoto(key, file) {
    const box = chat[key];
    if (!box.channel) return;

    const photo = await uploadPhoto(file, { channel: box.channel });
    const data = await api('/api/chat', { method: 'POST', body: { channel: box.channel, photo_id: photo.id } });

    box.messages.push(data.message);
    box.lastId = data.message.id;

    renderChat(key);
    markRead(box.channel, box.lastId);
  }

  /** Кнопка «скрепка»: выбираем файл и отправляем его в нужный чат. */
  function bindPhotoButton(button, input, channel, onDone) {
    if (!button || !input) return;

    button.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.value = '';
      if (!files.length) return;

      for (const file of files) {
        try {
          await sendChatPhotoTo(channel(), file);
        } catch (error) {
          toast(error.message);
        }
      }

      if (onDone) await onDone();
    });
  }

  async function sendChatPhotoTo(channel, file) {
    const photo = await uploadPhoto(file, { channel });
    await api('/api/chat', { method: 'POST', body: { channel, photo_id: photo.id } });
  }

  function markRead(channel, lastId) {
    api('/api/chat/read', { method: 'POST', body: { channel, lastId } })
      .then(() => refreshChatBadge())
      .catch(() => { /* не критично */ });
  }

  function setBadge(element, count) {
    if (!element) return;

    if (count > 0) {
      element.textContent = count > 99 ? '99+' : String(count);
      element.classList.remove('hidden');
    } else {
      element.classList.add('hidden');
    }
  }

  async function refreshChatBadge() {
    const generalBadge = $('#chatBadge');
    const ordersBadge = $('#ordersBadge');
    if (!generalBadge && !ordersBadge) return;

    try {
      const data = await api('/api/chat/unread');
      const channels = data.channels || {};

      // Всё, что относится к заказам: сообщения в их обсуждениях
      let ordersTotal = 0;

      for (const [channel, count] of Object.entries(channels)) {
        if (channel === 'general') continue;
        ordersTotal += count;
      }

      // Плюс изменения заказов, которые человек ещё не видел
      ordersTotal += Number(data.changes) || 0;

      setBadge(generalBadge, channels.general || 0);
      setBadge(ordersBadge, ordersTotal);

      // Разбивка по статусам: где именно новые изменения
      const byStatus = data.by_status || {};
      const before = JSON.stringify(state.statusChanges || {});

      state.statusChanges = byStatus;

      if (JSON.stringify(byStatus) !== before) renderStatusChips();

      // Непрочитанных стало больше — подаём сигнал
      const total = (Number(channels.general) || 0) + ordersTotal;

      if (lastUnreadTotal !== null && total > lastUnreadTotal) playPing();
      lastUnreadTotal = total;
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

      // На списке заказов тихо обновляем его, чтобы плашки появлялись сами
      if (state.view === 'orders') loadOrders(true);
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
    const qtyInput = $('#orderWorkQty');

    state.works.forEach((work) => {
      const option = document.createElement('option');
      option.value = work.id;
      option.textContent = `${work.name} — ${money(work.price)}${work.parts ? ` · ${qty(work.parts)} дет.` : ''}`;
      select.appendChild(option);
    });

    // Сколько деталей у работы — столько и подставляем в количество
    const applyParts = () => {
      const work = state.works.find((w) => String(w.id) === select.value);
      qtyInput.value = String(work && work.parts ? work.parts : 1);
    };

    select.addEventListener('change', applyParts);
    applyParts();

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
        <button data-mode="favorites" id="btnFavorites">★ Избранное</button>
      </div>

      <div id="addSearchWrap">
        <input type="text" id="matSearch" placeholder="Код или название материала…" autocomplete="off">

        <div class="focus-only" id="matExtras">
          <label class="clear-toggle mat-clear-toggle">
            <input type="checkbox" id="matClearToggle" checked>
            Очищать поиск при добавлении
          </label>

          <details class="manual-add" id="manualBlock">
            <summary>✏️ Добавить вручную</summary>
            <div class="manual-inputs">
              <input type="text" id="manualCode" placeholder="Код" style="width:35%">
              <input type="text" id="manualName" placeholder="Наименование" style="width:65%">
            </div>
            <div class="manual-btns">
              <button class="btn btn-left btn-sm" id="btnManualPaint">◀ В Эмаль</button>
              <button class="btn btn-right btn-sm" id="btnManualMaterial">В Материалы ▶</button>
            </div>
          </details>

          <div class="chips-row" id="matChips"></div>

          <div class="quick-box" id="quickBox">
            <div class="quick-row">
              <div class="quick-search-wrap">
                <input type="text" id="quickRecipe" class="quick-select" placeholder="Готовая краска: название" autocomplete="off">
                <div class="search-results hidden" id="quickRecipeResults"></div>
              </div>
              <input type="number" id="quickParts" value="1" min="0.1" step="0.05" title="Сколько деталей" class="quick-parts">
              <button class="btn btn-outline btn-sm" id="btnQuick">Списать</button>
            </div>
            <div id="quickResult"></div>
          </div>
        </div>

        <div class="material-hint" id="matHint">
          Начните вводить код или название — например, <b>110</b>, <b>127</b> или <b>скотч</b>.
          Коды Brulex и Standox работают в обе стороны.
        </div>
        <div class="search-results hidden" id="matResults"></div>
      </div>

      <div id="addRecipeWrap" class="hidden">
        <input type="text" id="recipeSearch" placeholder="Название цвета или код микса…" autocomplete="off">

        <button class="btn btn-outline btn-sm focus-only" id="woNewRecipe" style="margin-top:10px;width:100%">
          ＋ Новая готовая краска
        </button>

        <div class="focus-only hidden" id="woRecipeEditor">
          <div class="recipe-form">
            <input type="text" id="woRecipeName" placeholder="Название цвета, например «Серебро 570»">
            <div class="recipe-form-row">
              <input type="number" id="woRecipeBase" value="1000" min="1" step="1" placeholder="Сколько готовить, г">
              <input type="text" id="woMixCode" placeholder="Код микса">
              <input type="text" id="woMixName" placeholder="Название микса">
              <input type="number" id="woMixAmount" placeholder="г" min="0.1" step="0.1">
            </div>
            <button class="btn btn-outline btn-sm" id="woAddMix" style="width:100%">＋ Добавить микс в состав</button>
          </div>

          <div id="woMixList" class="recipe-mixes"></div>

          <div class="manual-btns">
            <button class="btn btn-primary btn-sm" id="woSaveRecipe">Сохранить</button>
            <button class="btn btn-outline btn-sm" id="woCancelRecipe">Отмена</button>
          </div>
        </div>

        <div class="search-results" id="recipeResults" style="margin-top:8px"></div>
      </div>
    `;

    let mode = 'materials';

    renderMaterialChips();

    // Быстрый набор работает только с готовыми красками: ищем по названию
    loadQuickRecipes();

    if ($('#btnQuick')) {
      $('#btnQuick').addEventListener('click', quickPreview);
    }

    const quickInput = $('#quickRecipe');

    if (quickInput) {
      let quickSearchTimer = null;

      quickInput.addEventListener('input', () => {
        quickRecipeName = '';
        clearTimeout(quickSearchTimer);
        quickSearchTimer = setTimeout(() => quickFilterRecipes(quickInput.value.trim()), 150);
      });

      quickInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;

        event.preventDefault();

        const panel = $('#quickRecipeResults');
        const first = panel && !panel.classList.contains('hidden')
          ? panel.querySelector('[data-quick-recipe]')
          : null;

        if (first) {
          pickQuickRecipe(first.dataset.quickRecipe);
        } else {
          quickPreview();
        }
      });

      quickInput.addEventListener('blur', () => {
        setTimeout(() => {
          const panel = $('#quickRecipeResults');
          if (panel) panel.classList.add('hidden');
        }, 180);
      });
    }

    if ($('#quickParts')) {
      $('#quickParts').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') quickPreview();
      });
    }

    const clearToggle = $('#matClearToggle');

    if (clearToggle) {
      clearToggle.checked = clearAfterAdd;
      clearToggle.addEventListener('change', () => {
        clearAfterAdd = clearToggle.checked;
        writeBool('paintShopClearAfterAdd', clearAfterAdd);
      });
    }

    if ($('#btnManualPaint')) $('#btnManualPaint').addEventListener('click', () => addManualMaterial('paint'));
    if ($('#btnManualMaterial')) $('#btnManualMaterial').addEventListener('click', () => addManualMaterial('material'));

    /* Новая готовая краска прямо из списания */
    if ($('#woNewRecipe')) {
      $('#woNewRecipe').addEventListener('click', () => {
        $('#woRecipeEditor').classList.remove('hidden');
        renderWriteOffDraft();
        $('#woRecipeName').focus();
      });
    }

    if ($('#woCancelRecipe')) {
      $('#woCancelRecipe').addEventListener('click', () => {
        writeOffDraft = [];
        renderWriteOffDraft();
        $('#woRecipeEditor').classList.add('hidden');
      });
    }

    if ($('#woAddMix')) $('#woAddMix').addEventListener('click', addWriteOffMix);
    if ($('#woSaveRecipe')) $('#woSaveRecipe').addEventListener('click', saveWriteOffRecipe);

    box.querySelectorAll('.mode-tabs button').forEach((button) => {
      button.addEventListener('click', () => {
        mode = button.dataset.mode;
        box.querySelectorAll('.mode-tabs button').forEach((b) => b.classList.toggle('active', b === button));
        $('#addSearchWrap').classList.toggle('hidden', mode === 'recipes');
        $('#addRecipeWrap').classList.toggle('hidden', mode !== 'recipes');

        if (mode === 'recipes') renderRecipeSearch('');
        else if (mode === 'favorites') showFavorites($('#matResults'));
        else searchMaterials($('#matSearch').value.trim());
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

  /* ------------------------------------------------------------------------
     Как в отдельной программе: категории, очистка поиска, ручное добавление
     ------------------------------------------------------------------------ */

  const MATERIAL_CATEGORIES = [
    ['paint', 'Краски'],
    ['primer', 'Грунты'],
    ['putty', 'Шпатлёвки'],
    ['clear', 'Лаки'],
    ['abrasive', 'Абразивы'],
    ['thinner', 'Растворители'],
    ['hardener', 'Отвердители'],
    ['consumable', 'Расходники'],
    ['other', 'Прочее']
  ];

  let materialCategory = 'all';
  let clearAfterAdd = readBool('paintShopClearAfterAdd', true);

  function readBool(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value === '1';
    } catch (error) {
      return fallback;
    }
  }

  function writeBool(key, value) {
    try { localStorage.setItem(key, value ? '1' : '0'); } catch (error) { /* приватный режим */ }
  }

  function renderMaterialChips() {
    const box = $('#matChips');
    if (!box) return;

    box.innerHTML = '';

    const make = (id, label) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (materialCategory === id ? ' active' : '');
      chip.textContent = label;

      chip.addEventListener('click', () => {
        materialCategory = id;
        renderMaterialChips();
        searchMaterials($('#matSearch').value.trim());
      });

      box.appendChild(chip);
    };

    make('all', 'Все');
    make('favorites', '★ Избранное');

    for (const [id, label] of MATERIAL_CATEGORIES) make(id, label);
  }

  async function addManualMaterial(kind) {
    const code = $('#manualCode').value.trim();
    const name = $('#manualName').value.trim();

    if (!name) {
      toast('Введите наименование');
      return;
    }

    await addMaterial({
      code: code || 'MAN-' + Date.now().toString(36).toUpperCase(),
      name,
      unit: kind === 'paint' ? 'г' : 'шт'
    }, kind);

    $('#manualCode').value = '';
    $('#manualName').value = '';
  }

  /* ---- Быстрый набор материалов по количеству деталей --------------------- */

  /* ---- Быстрый набор материалов по количеству деталей --------------------- */

  /** Готовые краски держим в памяти: со временем их будет много. */
  let quickRecipes = [];
  let quickRecipeName = '';

  async function loadQuickRecipes() {
    try {
      const data = await api('/api/recipes');
      quickRecipes = data.recipes || [];

      if (!quickRecipes.length) {
        const input = $('#quickRecipe');

        if (input) {
          input.disabled = true;
          input.placeholder = 'Готовых красок пока нет';
        }

        if ($('#btnQuick')) $('#btnQuick').disabled = true;

        const result = $('#quickResult');
        if (result) {
          result.innerHTML = '<div class="muted quick-hint">Сначала создайте готовую краску — вкладка «Готовые краски».</div>';
        }
      }
    } catch (error) {
      const input = $('#quickRecipe');

      if (input) {
        input.disabled = true;
        input.placeholder = 'Не удалось загрузить краски';
      }

      if ($('#btnQuick')) $('#btnQuick').disabled = true;
    }
  }

  /** Подсказки по названию: ищем только среди готовых красок. */
  function quickFilterRecipes(term) {
    const panel = $('#quickRecipeResults');
    if (!panel) return;

    const needle = String(term || '').toLowerCase();

    const found = (needle
      ? quickRecipes.filter((row) => String(row.name).toLowerCase().includes(needle) || (looseKey(needle).length > 1 && looseKey(row.name).includes(looseKey(needle))))
      : quickRecipes
    ).slice(0, 8);

    if (!found.length) {
      panel.innerHTML = '<div class="row" style="cursor:default">Краска не найдена</div>';
      panel.classList.remove('hidden');
      return;
    }

    panel.innerHTML = found.map((row) => `
      <div class="row" data-quick-recipe="${esc(row.name)}">
        ${row.photo ? `<img class="quick-thumb" src="${esc(row.photo)}" alt="" loading="lazy">` : '<span class="quick-thumb quick-thumb-empty"></span>'}
        <span class="name">${esc(row.name)}</span>
        <span class="muted mono">${qty(row.base)} г</span>
      </div>
    `).join('');

    panel.classList.remove('hidden');

    panel.querySelectorAll('[data-quick-recipe]').forEach((element) => {
      element.addEventListener('click', () => pickQuickRecipe(element.dataset.quickRecipe));
    });
  }

  function pickQuickRecipe(name) {
    const input = $('#quickRecipe');
    const panel = $('#quickRecipeResults');
    const result = $('#quickResult');

    if (input) input.value = name;
    if (panel) panel.classList.add('hidden');
    if (result) result.innerHTML = '';

    quickRecipeName = name;
  }

  async function quickPreview() {
    const partsInput = $('#quickParts');
    const result = $('#quickResult');
    const input = $('#quickRecipe');

    if (!result || !state.order) return;

    // Краска должна быть выбрана из подсказок
    const typed = input ? input.value.trim() : '';
    const exact = quickRecipes.find((row) => String(row.name).toLowerCase() === typed.toLowerCase());
    const recipe = quickRecipeName || (exact ? exact.name : '');

    if (!recipe) {
      result.innerHTML = '<div class="muted quick-hint">Выберите готовую краску из подсказок.</div>';
      return;
    }

    quickRecipeName = recipe;

      const parts = Number(partsInput.value) || 1;

      result.innerHTML = '<div class="muted quick-hint">Считаю…</div>';

      try {
        const data = await api(`/api/norms/quick?parts=${encodeURIComponent(parts)}&recipe=${encodeURIComponent(recipe)}`);

        if (!data.items.length) {
          result.innerHTML = '<div class="muted quick-hint">Нормы не заданы. Задайте их в разделе «Нормы списания».</div>';
          return;
        }

        const chosen = quickRecipes.find((row) => row.name === recipe);

        result.innerHTML = `
          <div class="quick-picked">
            ${chosen && chosen.photo
              ? `<img class="recipe-thumb" src="${esc(chosen.photo)}" alt="Цвет краски" loading="lazy">`
              : '<span class="recipe-thumb recipe-thumb-empty"></span>'}
            <b>${esc(recipe)}</b>
            <span class="muted">· ${qty(parts)} дет.</span>
          </div>
          <div class="quick-list">
            ${data.items.map((item) => `
              <div class="quick-line">
                <span>${esc(item.name)}</span>
                <span class="mono">${qty(item.qty)} ${esc(item.unit)}${item.per === 'order' ? ' <span class="muted">на машину</span>' : ''}</span>
              </div>`).join('')}
          </div>
          <button class="btn btn-primary btn-sm" id="btnQuickAdd" style="width:100%;margin-top:6px">
            Добавить в списание (${data.items.length})
          </button>
        `;

        $('#btnQuickAdd').addEventListener('click', async () => {
          const button = $('#btnQuickAdd');
          button.disabled = true;
          button.textContent = 'Добавляю…';

          try {
            for (const item of data.items) {
              await api(`/api/orders/${state.order.id}/materials`, {
                method: 'POST',
                body: {
                  code: item.code,
                  name: item.name,
                  unit: item.unit,
                  qty: item.qty,
                  kind: item.unit === 'г' ? 'paint' : 'material'
                }
              });
            }

            const fresh = await api('/api/orders/' + state.order.id);
            state.order = fresh.order;
            renderOrder();

            toast(`Добавлено: ${qty(parts)} дет., краска «${data.recipe}»`);
          } catch (error) {
            toast(error.message);
            button.disabled = false;
            button.textContent = 'Добавить в списание';
          }
        });
      } catch (error) {
        result.innerHTML = `<div class="muted quick-hint">${esc(error.message)}</div>`;
      }
    }

/* ---- Нормы списания: свой набор у каждого маляра, общая база для всех --- */

  let normsCommon = [];
  let normsMine = [];
  let normsDraftSet = [];
  let normsScope = 'mine';
  let normPick = null;

  const canEditCommon = () => state.user && (state.user.role === 'admin' || state.user.role === 'manager');

  async function loadNormsView() {
    const host = $('#normsSetList');
    if (!host) return;

    host.innerHTML = '<div class="spinner">Загрузка…</div>';

    try {
      const data = await api('/api/norm-set');

      normsCommon = data.common || [];
      normsMine = data.mine || [];

      // У маляра со своими нормами открываем личные, иначе — общую базу
      normsScope = normsMine.length ? 'mine' : (canEditCommon() ? 'common' : 'mine');

      const mineRadio = document.querySelector('input[name="normScope"][value="mine"]');
      const commonRadio = document.querySelector('input[name="normScope"][value="common"]');

      if (mineRadio) mineRadio.checked = normsScope === 'mine';
      if (commonRadio) commonRadio.checked = normsScope === 'common';

      // Общую базу маляру показываем, но менять не даём
      const commonLabel = $('#normCommonLabel');
      if (commonLabel) commonLabel.classList.toggle('hidden', !canEditCommon() && !normsCommon.length);

      renderNormsSet();
    } catch (error) {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

  function normsForScope() {
    return normsScope === 'common' ? normsCommon : normsMine;
  }

  function renderNormsSet() {
    const host = $('#normsSetList');
    if (!host) return;

    const editable = normsScope === 'mine' || canEditCommon();

    // Своих норм ещё нет — показываем общую базу как заготовку для копии
    const source = (normsScope === 'mine' && !normsMine.length) ? normsCommon : normsForScope();

    normsDraftSet = source.map((row) => ({
      code: row.code,
      name: row.role === 'paint' ? 'Краска — по выбору в наряде' : (row.name || row.code),
      role: row.role,
      qty: row.qty,
      unit: row.unit,
      per: row.per
    }));

    const label = $('#normsScopeLabel');
    if (label) {
      label.textContent = normsScope === 'common'
        ? (canEditCommon() ? 'общая база — для всех' : 'общая база — только просмотр')
        : (normsMine.length ? 'ваши личные нормы' : 'пока не заданы — ниже общая база');
    }

    if (!normsDraftSet.length) {
      host.innerHTML = '<div class="muted" style="padding:10px 0">Список пуст. Добавьте материалы ниже.</div>';
      return;
    }

    host.innerHTML = `
      <table class="grid">
        <thead><tr><th>Материал</th><th class="num">Кол-во</th><th>Когда</th><th></th></tr></thead>
        <tbody>
          ${normsDraftSet.map((row, index) => `
            <tr>
              <td data-label="Материал">${esc(row.name)}</td>
              <td class="num" data-label="Кол-во">
                ${editable
                  ? `<input type="number" value="${row.qty}" min="0.01" step="0.01" data-norm-qty="${index}" style="width:96px;text-align:right"> <span class="unit">${esc(row.unit)}</span>`
                  : `<span class="mono">${qty(row.qty)} ${esc(row.unit)}</span>`}
              </td>
              <td data-label="Когда">
                ${editable
                  ? `<select data-norm-per="${index}">
                       <option value="part"${row.per === 'part' ? ' selected' : ''}>на деталь</option>
                       <option value="order"${row.per === 'order' ? ' selected' : ''}>на машину</option>
                     </select>`
                  : (row.per === 'part' ? 'на деталь' : 'на машину')}
              </td>
              <td>${editable ? `<button class="row-del" data-norm-del="${index}" title="Убрать">×</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    host.querySelectorAll('[data-norm-qty]').forEach((input) => {
      input.addEventListener('change', () => {
        const row = normsDraftSet[Number(input.dataset.normQty)];
        if (row) row.qty = Number(input.value) || 0;
      });
    });

    host.querySelectorAll('[data-norm-per]').forEach((select) => {
      select.addEventListener('change', () => {
        const row = normsDraftSet[Number(select.dataset.normPer)];
        if (row) row.per = select.value;
      });
    });

    host.querySelectorAll('[data-norm-del]').forEach((button) => {
      button.addEventListener('click', () => {
        normsDraftSet.splice(Number(button.dataset.normDel), 1);
        renderNormsDraftOnly();
      });
    });
  }

  /** Перерисовка без перезагрузки с сервера (после правок в таблице). */
  function renderNormsDraftOnly() {
    const keepMine = normsMine;
    const keepCommon = normsCommon;

    normsMine = normsScope === 'mine' ? normsDraftSet : keepMine;
    normsCommon = normsScope === 'common' ? normsDraftSet : keepCommon;

    renderNormsSet();
  }

  async function pickNormItem(term) {
    const wrap = $('#normResults');
    if (!wrap) return;

    if (!term) {
      wrap.classList.add('hidden');
      return;
    }

    try {
      const data = await api('/api/materials?q=' + encodeURIComponent(term));

      wrap.innerHTML = data.materials.slice(0, 8).map((item) => `
        <div class="row" data-norm-item="${esc(item.code)}">
          <span class="code">${esc(item.code)}</span>
          <span class="name">${esc(item.name)}</span>
        </div>
      `).join('') || '<div class="row" style="cursor:default">Ничего не найдено</div>';

      wrap.classList.remove('hidden');

      wrap.querySelectorAll('[data-norm-item]').forEach((row) => {
        row.addEventListener('click', () => {
          const item = data.materials.find((m) => m.code === row.dataset.normItem);
          const amount = Number($('#normQty').value) || 100;

          normsDraftSet = normsDraftSet.filter((n) => n.code !== item.code);
          normsDraftSet.push({
            code: item.code,
            name: item.name,
            role: 'material',
            qty: amount,
            unit: item.category === 'paint' ? 'г' : (item.unit || 'шт'),
            per: $('#normPer').value
          });

          renderNormsDraftOnly();

          $('#normSearch').value = '';
          wrap.classList.add('hidden');
        });
      });
    } catch (error) {
      wrap.classList.add('hidden');
    }
  }

  async function saveNormsSet() {
    try {
      await api('/api/norm-set', {
        method: 'PUT',
        body: { scope: normsScope, items: normsDraftSet }
      });

      toast('Нормы сохранены');
      await loadNormsView();
    } catch (error) {
      toast(error.message);
    }
  }

  async function resetNormsSet() {
    try {
      await api('/api/norm-set', { method: 'DELETE' });
      toast('Вернулись к общей базе');
      await loadNormsView();
    } catch (error) {
      toast(error.message);
    }
  }

  async function searchMaterials(term) {
    const wrap = $('#matResults');

    const hint = $('#matHint');
    if (hint) hint.classList.toggle('hidden', Boolean(term));

    try {
      const data = await api('/api/materials?q=' + encodeURIComponent(term));
      wrap.innerHTML = '';

      if (!data.materials.length) {
        wrap.innerHTML = '<div class="row" style="cursor:default">Ничего не найдено</div>';
        wrap.classList.remove('hidden');
        return;
      }

      const list = materialCategory === 'all'
        ? data.materials
        : data.materials.filter((item) => (materialCategory === 'favorites'
            ? favorites.has(item.code)
            : item.category === materialCategory));

      if (!list.length) {
        wrap.innerHTML = '<div class="row" style="cursor:default">В этой категории ничего нет</div>';
        wrap.classList.remove('hidden');
        return;
      }

      list.forEach((item) => wrap.appendChild(materialRow(item)));

      wrap.classList.remove('hidden');
    } catch (error) {
      toast(error.message);
    }
  }

  /* Избранные материалы: у каждого сотрудника свои */
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

    row.innerHTML = `
      <div class="item-text">
        <span class="code">${esc(item.code)}</span>
        <span class="name">${esc(item.name)}${tdsButton(item)}${item.aliases ? `<br><span class="muted">${esc(item.aliases)}</span>` : ''}${stockText ? `<br><span class="${stockClass}">${esc(stockText)}</span>` : ''}</span>
      </div>
      <button class="fav-star${favorites.has(item.code) ? ' active' : ''}" title="В избранное">${favorites.has(item.code) ? '★' : '☆'}</button>
      <button class="btn btn-left btn-sm" data-kind="paint">◀ Эмаль</button>
      <button class="btn btn-right btn-sm" data-kind="material">Материал ▶</button>
    `;

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
      wrap.innerHTML = `<div class="row" style="cursor:default">${esc(error.message)}</div>`;
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

      // «Очищать поиск при добавлении» — как в отдельной программе
      if (clearAfterAdd) {
        const input = $('#matSearch');
        const results = $('#matResults');

        if (input) {
          input.value = '';
          input.focus();
        }

        if (results) {
          results.innerHTML = '';
          results.classList.add('hidden');
        }
      }

      toast(`${item.name} — добавлено`);
    } catch (error) {
      toast(error.message);
    }
  }

  /* ------------------------------------------------------------------------
     Новая готовая краска прямо из списания
     ------------------------------------------------------------------------ */

  let writeOffDraft = [];

  function renderWriteOffDraft() {
    const host = $('#woMixList');
    if (!host) return;

    if (!writeOffDraft.length) {
      host.innerHTML = '<div class="muted" style="padding:8px 0">Состав пуст</div>';
      return;
    }

    host.innerHTML = writeOffDraft.map((mix, index) => `
      <div class="recipe-mix-row">
        <span class="recipe-mix-name">${esc(mix.name)}</span>
        <span class="mono">${qty(mix.amount)} г</span>
        <button class="row-del" data-mix-remove="${index}" title="Убрать">×</button>
      </div>
    `).join('');

    host.querySelectorAll('[data-mix-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        writeOffDraft.splice(Number(button.dataset.mixRemove), 1);
        renderWriteOffDraft();
      });
    });
  }

  async function addWriteOffMix() {
    const code = $('#woMixCode').value.trim();
    const name = $('#woMixName').value.trim();
    const amount = Number($('#woMixAmount').value) || 0;

    if (!amount || amount <= 0) {
      toast('Укажите количество в граммах');
      return;
    }

    // Если код указан, а названия нет — подставим название из справочника
    let mixName = name;
    let mixCode = code || '—';

    if (!mixName && code) {
      try {
        const found = (await api('/api/materials?q=' + encodeURIComponent(code))).materials;
        if (found.length) {
          mixName = found[0].name;
          mixCode = found[0].code;
        }
      } catch (error) {
        /* ниже покажем ошибку */
      }
    }

    if (!mixName) {
      toast('Укажите код или название микса');
      return;
    }

    writeOffDraft.push({ code: mixCode, name: mixName, amount });
    renderWriteOffDraft();

    ['woMixCode', 'woMixName', 'woMixAmount'].forEach((id) => { $('#' + id).value = ''; });
    $('#woMixCode').focus();
  }

  async function saveWriteOffRecipe() {
    const name = $('#woRecipeName').value.trim();
    const base = Number($('#woRecipeBase').value) || 0;

    if (!name) {
      toast('Введите название цвета');
      return;
    }

    if (!writeOffDraft.length) {
      toast('Добавьте хотя бы один микс');
      return;
    }

    try {
      await api('/api/recipes', {
        method: 'POST',
        body: { name, base: base || 1000, unit: 'г', mixes: writeOffDraft }
      });

      state.recipes = (await api('/api/recipes')).recipes;
      toast('Готовая краска сохранена');

      writeOffDraft = [];
      renderWriteOffDraft();
      $('#woRecipeName').value = '';
      $('#woRecipeEditor').classList.add('hidden');
      renderRecipeSearch('');
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
        ${recipe.photo
          ? `<img class="recipe-thumb" src="${esc(recipe.photo)}" alt="" loading="lazy">`
          : '<span class="recipe-thumb recipe-thumb-empty"></span>'}
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

  /* ------------------------------------------------------------------------
     Черновик нового заказа: сохраняется сам, чтобы не терять заполненное
     ------------------------------------------------------------------------ */

  const DRAFT_FIELDS = ['carPlate', 'carVin', 'carMake', 'carModel', 'carColor',
    'ownerName', 'ownerPhone', 'masterSelect', 'bodyworkerSelect', 'plannedDate', 'orderComment'];

  function draftKey() {
    return 'paintShopNewOrderDraft:' + ((state.user && state.user.id) || 'guest');
  }

  function readNewOrderDraft() {
    try {
      const raw = localStorage.getItem(draftKey());
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function draftHasContent(draft) {
    if (!draft) return false;
    if (Array.isArray(draft.works) && draft.works.length) return true;

    return Object.values(draft.fields || {}).some((value) => String(value || '').trim() !== '');
  }

  /** Пишем черновик при каждом изменении полей. */
  function saveNewOrderDraft() {
    const form = $('#newOrderForm');
    if (!form) return;

    const draft = { at: new Date().toISOString(), fields: {}, works: state.newWorks };

    DRAFT_FIELDS.forEach((id) => {
      const field = $('#' + id);
      if (field) draft.fields[id] = field.value;
    });

    try {
      if (draftHasContent(draft)) {
        localStorage.setItem(draftKey(), JSON.stringify(draft));
      } else {
        localStorage.removeItem(draftKey());
      }
    } catch (error) {
      /* место в браузере могло кончиться — не ломаем форму */
    }

    paintDraftBar(draft);
  }

  let draftTimer = null;

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveNewOrderDraft, 400);
  }

  function paintDraftBar(draft) {
    const bar = $('#draftBar');
    const text = $('#draftText');
    if (!bar) return;

    if (!draftHasContent(draft)) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');

    if (text) {
      const at = draft.at ? new Date(draft.at) : new Date();
      const time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      text.textContent = 'Черновик сохранён в ' + time + ' — можно уйти и вернуться';
    }
  }

  function clearNewOrderDraft() {
    try {
      localStorage.removeItem(draftKey());
    } catch (error) {
      /* ничего */
    }

    const bar = $('#draftBar');
    if (bar) bar.classList.add('hidden');
  }

  /** Возвращаем заполненное, когда снова открыли новый заказ. */
  function restoreNewOrderDraft() {
    const draft = readNewOrderDraft();

    if (!draftHasContent(draft)) {
      const bar = $('#draftBar');
      if (bar) bar.classList.add('hidden');
      return false;
    }

    DRAFT_FIELDS.forEach((id) => {
      const field = $('#' + id);
      if (field && draft.fields && draft.fields[id] != null) field.value = draft.fields[id];
    });

    state.newWorks = Array.isArray(draft.works) ? draft.works : [];
    renderNewWorks();
    paintDraftBar(draft);

    return true;
  }

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
      option.textContent = `${work.name} — ${money(work.price)}${work.parts ? ` · ${qty(work.parts)} дет.` : ''}`;
      workSelect.appendChild(option);
    });

    // Покраска измеряется в деталях — количество подставляем сразу
    const applyWorkParts = () => {
      const work = state.works.find((w) => String(w.id) === workSelect.value);
      if ($('#workQty')) $('#workQty').value = String(work && work.parts ? work.parts : 1);
    };

    workSelect.addEventListener('change', applyWorkParts);
    applyWorkParts();

    // Если есть недозаполненный заказ — возвращаем его
    restoreNewOrderDraft();

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

      clearNewOrderDraft();

      state.order = data.order;
      showView('order');
      refreshWindowTitles();
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
              <td data-label="Мастер">${esc(row.master_name)}</td>
              <td class="num" data-label="Заказов">${row.orders}</td>
              <td class="num" data-label="Закрыто">${row.closed}</td>
              <td class="num" data-label="В работе">${row.in_work}</td>
              <td class="num mono" data-label="Работы">${money(row.works_sum)}</td>
              <td class="num mono" data-label="Материалы">${money(row.materials_sum)}</td>
              <td class="num mono" data-label="Итого"><b>${money(row.total)}</b></td>
            </tr>`).join('')
        : '<tr><td colspan="7" class="empty-line">За этот период заказов нет</td></tr>';

      const materialsRows = data.materials.length
        ? data.materials.map((row) => `
            <tr>
              <td class="code-cell" data-label="Код">${esc(row.code)}</td>
              <td data-label="Наименование">${esc(row.name)}</td>
              <td class="num" data-label="Кол-во">${qty(row.qty)} ${esc(row.unit)}</td>
              <td class="num mono" data-label="Стоимость">${money(row.cost)}</td>
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
    selectRefsTab(refsTab);
    renderWorksRef();
    renderRecipesRef();
    renderMaterialsRef();
    loadCodes();
  }

  /* ------------------------------------------------------------------------
     Клиенты
     ------------------------------------------------------------------------ */

  /** Телефон для показа: 79001234567 → +7 (900) 123-45-67 */
  function prettyPhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '—';

    const last10 = digits.slice(-10);

    if (last10.length === 10) {
      return `+7 (${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6, 8)}-${last10.slice(8, 10)}`;
    }

    return digits;
  }

  const STATUS_NAMES = {
    draft: 'Черновик',
    accepted: 'Принят',
    in_work: 'В работе',
    ready: 'Готов',
    closed: 'Закрыт',
    cancelled: 'Отменён'
  };

  async function loadClients(search) {
    const host = $('#clientsList');
    if (!host) return;

    host.innerHTML = '<div class="spinner">Загрузка…</div>';

    try {
      const query = search !== undefined
        ? search
        : ($('#clientSearch') ? $('#clientSearch').value.trim() : '');

      const data = await api('/api/clients' + (query ? '?q=' + encodeURIComponent(query) : ''));

      state.clients = data.clients;
      renderClients();
    } catch (error) {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

  function renderClients() {
    const host = $('#clientsList');
    if (!host) return;

    if (!state.clients.length) {
      host.innerHTML = '<div class="empty-line">Клиентов пока нет — они появятся из заказов</div>';
      return;
    }

    host.innerHTML = `
      <table class="grid">
        <thead>
          <tr>
            <th>Клиент</th><th>Телефон</th><th class="num">Машин</th>
            <th class="num">Заказов</th><th>Был</th><th class="num">На сумму</th>
          </tr>
        </thead>
        <tbody>
          ${state.clients.map((client) => `
            <tr data-client="${esc(client.phone)}" style="cursor:pointer">
              <td data-label="Клиент">${esc(client.name || 'Без имени')}</td>
              <td class="mono" data-label="Телефон">${esc(prettyPhone(client.phone))}</td>
              <td class="num" data-label="Машин">${client.cars}</td>
              <td class="num" data-label="Заказов">${client.orders}</td>
              <td class="muted" data-label="Был">${client.last_at ? dateOnly(client.last_at) : '—'}</td>
              <td class="num mono" data-label="На сумму">${money(client.total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    host.querySelectorAll('[data-client]').forEach((row) => {
      row.addEventListener('click', () => openClient(row.dataset.client));
    });
  }

  async function openClient(phone) {
    const card = $('#clientCard');
    const body = $('#clientCardBody');
    const title = $('#clientCardTitle');

    if (!card || !body) return;

    card.classList.remove('hidden');
    body.innerHTML = '<div class="spinner">Загрузка…</div>';

    try {
      const data = await api('/api/clients/' + encodeURIComponent(phone));

      title.textContent = `${data.client.name || 'Без имени'} · ${prettyPhone(data.client.phone)}`;

      const cars = data.cars.length
        ? data.cars.map((car) => `<span class="pill">${esc(car.plate)}${car.make ? ' · ' + esc([car.make, car.model].filter(Boolean).join(' ')) : ''}</span>`).join(' ')
        : '<span class="muted">Машин нет</span>';

      const orders = data.orders.length
        ? data.orders.map((order) => `
            <div class="client-order">
              <div class="client-order-head">
                <b>№ ${esc(order.number)}</b>
                <span class="muted">${dateOnly(order.created_at)}</span>
                <span class="order-status status-${esc(order.status)}">${esc(STATUS_NAMES[order.status] || order.status)}</span>
                <b class="mono">${money(order.total)} ₽</b>
              </div>
              <div class="muted">${esc(order.works.join(', ') || 'работы не указаны')}</div>
            </div>`).join('')
        : '<div class="empty-line">Заказов пока не было</div>';

      body.innerHTML = `
        <div class="client-cars">${cars}</div>
        <div class="section-head"><h3>Выполненные работы</h3></div>
        ${orders}
      `;

      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      body.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

  function closeClient() {
    const card = $('#clientCard');
    if (card) card.classList.add('hidden');
  }

  /* ---- Склад: видно всем, правит кладовщик -------------------------------- */

  const canStore = () => state.user && (state.user.role === 'admin' || state.user.role === 'store');

  async function loadWarehouse(term) {
    const host = $('#warehouseList');
    if (!host) return;

    const card = $('#stockAddCard');
    if (card) card.classList.toggle('hidden', !canStore());

    host.innerHTML = '<div class="spinner">Загрузка…</div>';

    try {
      const query = term !== undefined
        ? term
        : ($('#warehouseSearch') ? $('#warehouseSearch').value.trim() : '');

      const data = await api('/api/stock' + (query ? '?q=' + encodeURIComponent(query) : ''));

      state.stock = data.items;
    loadLowStock();
      renderWarehouse();
    } catch (error) {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

function renderWarehouse() {
    const host = $('#warehouseList');
    if (!host) return;

    const lowOnly = $('#stockLowOnly') && $('#stockLowOnly').checked;
    const list = lowOnly ? state.stock.filter((item) => item.low) : state.stock;

    if (!list.length) {
      host.innerHTML = '<div class="empty-line">' + (lowOnly ? 'Всё в норме — ничего не заканчивается' : 'Ничего не найдено') + '</div>';
      return;
    }

    const staff = canStore();

    host.innerHTML = `
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
          ${list.map((item) => `
            <tr class="${item.low ? 'stock-row-low' : ''}">
              <td class="code-cell" data-label="Код">${esc(item.code)}</td>
              <td data-label="Наименование">
                ${esc(item.name)} ${tdsButton(item)}
                ${item.low ? '<span class="stock-badge empty">пора заказать</span>' : ''}
              </td>
              <td class="num" data-label="Остаток">
                ${staff
                  ? `<span class="stock-inline">
                       <input type="number" min="0" step="0.01" value="${item.left}"
                              data-stock-code="${esc(item.code)}" class="stock-input">
                       <span class="unit">${esc(item.unit)}</span>
                     </span>`
                  : `<span class="stock-badge${item.left <= 0 ? ' empty' : ''}">${qty(item.left)} ${esc(item.unit)}</span>`}
              </td>
              <td class="num" data-label="Минимум">
                ${staff
                  ? `<input type="number" min="0" step="0.01" value="${item.min_stock || 0}"
                            data-stock-min="${esc(item.code)}" class="stock-input stock-min-input">`
                  : (item.min_stock ? `<span class="mono">${qty(item.min_stock)} ${esc(item.unit)}</span>` : '<span class="muted">—</span>')}
              </td>
              <td class="stock-actions">
                ${staff ? `<button class="btn btn-outline btn-sm" data-stock-in="${esc(item.code)}">Приход</button>` : ''}
                <button class="btn btn-outline btn-sm" data-stock-history="${esc(item.code)}">История</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

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

    modal.classList.add('open');
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

      $('#stockIncomingModal').classList.remove('open');
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
    modal.classList.add('open');

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


  async function addStockItem() {
    const name = $('#stockName').value.trim();
    const code = $('#stockCode').value.trim();
    const unit = $('#stockUnit').value;
    const category = $('#stockCategory').value;
    const left = Number($('#stockLeft').value) || 0;

    if (!name) {
      toast('Введите наименование');
      return;
    }

    try {
      await api('/api/stock', { method: 'POST', body: { name, code, unit, category, stock: left } });

      ['stockName', 'stockCode'].forEach((id) => { $('#' + id).value = ''; });
      $('#stockLeft').value = '0';

      toast('Материал добавлен на склад');
      loadWarehouse();
    } catch (error) {
      toast(error.message);
    }
  }

  /* ---- Перевод кодов красок ------------------------------------------------ */

  async function loadCodes(search) {
    const host = $('#codesList');
    if (!host) return;

    host.innerHTML = '<div class="spinner">Загрузка…</div>';

    try {
      const query = search !== undefined ? search : ($('#codesSearch') ? $('#codesSearch').value.trim() : '');
      const data = await api('/api/codes' + (query ? '?q=' + encodeURIComponent(query) : ''));

      state.codes = data.pairs;
      renderCodes();
    } catch (error) {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

  function renderCodes() {
    const host = $('#codesList');
    if (!host) return;

    if (!state.codes.length) {
      host.innerHTML = '<div class="empty-line">Соответствий пока нет — вставьте пары выше</div>';
      return;
    }

    host.innerHTML = `
      <table class="grid">
        <thead><tr><th>Brulex</th><th>Standox</th><th></th></tr></thead>
        <tbody>
          ${state.codes.map((pair) => `
            <tr>
              <td class="mono" data-label="Brulex">${esc(pair.code_a)}</td>
              <td class="mono" data-label="Standox">${esc(pair.code_b)}</td>
              <td class="num" data-label="">${isManager() ? `<button class="row-del" data-del-code="${pair.id}" title="Убрать">×</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    host.querySelectorAll('[data-del-code]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api('/api/codes/' + button.dataset.delCode, { method: 'DELETE' });
          await loadCodes();
        } catch (error) {
          toast(error.message);
        }
      });
    });
  }

  async function importCodes() {
    const field = $('#codesBulk');
    const status = $('#codesStatus');
    const text = field.value.trim();

    if (!text) {
      toast('Вставьте пары кодов');
      return;
    }

    try {
      const data = await api('/api/codes/import', { method: 'POST', body: { text } });
      field.value = '';

      if (status) {
        status.textContent = `Добавлено: ${data.added}${data.skipped ? `, пропущено: ${data.skipped}` : ''}`;
      }

      toast(`Добавлено пар: ${data.added}`);
      await loadCodes('');
      if ($('#codesSearch')) $('#codesSearch').value = '';
    } catch (error) {
      toast(error.message);
    }
  }

  function renderWorksRef() {
    const host = $('#worksTable');

    const query = refsWorkQuery.trim().toLowerCase();

    const works = query
      ? state.works.filter((work) => `${work.name} ${work.category || ''}`.toLowerCase().includes(query))
      : state.works;

    if (!works.length) {
      host.innerHTML = `<div class="empty-line">${query ? 'Ничего не найдено' : 'Прайс пуст'}</div>`;
      return;
    }

    host.innerHTML = `
      <table class="grid">
        <thead><tr><th>Работа</th><th>Категория</th><th class="num">Детали</th><th class="num">Цена</th></tr></thead>
        <tbody>
          ${works.map((work) => `
            <tr>
              <td data-label="Работа">${esc(work.name)}</td>
              <td class="muted" data-label="Категория">${esc(work.category || '—')}</td>
              <td class="num" data-label="Детали">
                ${!work.parts
                  ? '<span class="muted">—</span>'
                  : isManager()
                    ? `<input type="number" value="${work.parts}" min="0.1" step="0.05" data-work-parts="${work.id}"
                              style="width:90px;padding:6px;border:1px solid var(--border);border-radius:5px;text-align:right">`
                    : `<span class="mono">${qty(work.parts)}</span>`}
              </td>
              <td class="num" data-label="Цена">
                ${isManager()
                  ? `<input type="number" value="${work.price}" min="0" step="0.01" data-work-price="${work.id}"
                            style="width:120px;padding:6px;border:1px solid var(--border);border-radius:5px;text-align:right">`
                  : `<span class="mono">${money(work.price)}</span>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;

    host.querySelectorAll('[data-work-parts]').forEach((input) => {
      input.addEventListener('change', async () => {
        const value = Number(input.value) || 1;

        try {
          await api('/api/works/' + input.dataset.workParts, {
            method: 'PATCH',
            body: { parts: value }
          });

          const work = state.works.find((w) => String(w.id) === input.dataset.workParts);
          if (work) work.parts = value;
          toast('Количество деталей обновлено');
        } catch (error) {
          toast(error.message);
        }
      });
    });

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

  /* ---- Справочники: разделы вместо длинной ленты -------------------------- */

  let refsTab = (() => {
    try { return localStorage.getItem('refsTab') || 'works'; } catch (error) { return 'works'; }
  })();
  let refsWorkQuery = '';
  let refsRecipeQuery = '';

  function selectRefsTab(name) {
    refsTab = name || 'works';

    try { localStorage.setItem('refsTab', refsTab); } catch (error) { /* приватный режим */ }

    document.querySelectorAll('.refs-tab').forEach((button) => {
      button.classList.toggle('active', button.dataset.refs === refsTab);
    });

    document.querySelectorAll('[data-refs-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.refsPanel !== refsTab);
    });
  }

  function renderRecipesRef() {
    const host = $('#recipesList');

    const query = refsRecipeQuery.trim().toLowerCase();

    const recipes = query
      ? state.recipes.filter((recipe) => {
          const haystack = `${recipe.name} ${recipe.mixes.map((m) => `${m.name} ${m.code}`).join(' ')}`.toLowerCase();
          return haystack.includes(query);
        })
      : state.recipes;

    if (!recipes.length) {
      host.innerHTML = `<div class="empty-line">${query ? 'Ничего не найдено' : 'Готовых красок пока нет'}</div>`;
      return;
    }

    host.innerHTML = `
      <table class="grid">
        <thead><tr><th>Название</th><th>Состав</th><th></th></tr></thead>
        <tbody>
          ${recipes.map((recipe) => `
            <tr>
              <td><div class="recipe-name-cell">${recipe.photo ? `<img class="recipe-thumb" src="${esc(recipe.photo)}" alt="" loading="lazy">` : ''}<div><b>${esc(recipe.name)}</b><br><span class="muted">на ${qty(recipe.base)} ${esc(recipe.unit)}</span></div></div></td>
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
                <td class="code-cell" data-label="Код">${esc(item.code)}</td>
                <td data-label="Наименование">${esc(item.name)}${item.aliases ? `<span class="muted"> · ${esc(item.aliases)}</span>` : ''}</td>
                <td class="num">
                  ${isManager()
                    ? `<input type="number" value="${item.price}" min="0" step="0.01" data-mat-price="${esc(item.code)}"
                              style="width:110px;padding:6px;border:1px solid var(--border);border-radius:5px;text-align:right">`
                    : `<span class="mono">${money(item.price)}</span>`}
                </td>
                <td class="muted" data-label="Ед.">${esc(item.unit)}</td>
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
    renderRecipePhoto(recipe ? recipe.photo : null);
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

  /** Сжимаем фото до миниатюры 200x150: весит единицы килобайт. */
  function cropRecipePhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const image = new Image();

        image.onload = () => {
          const targetW = 200;
          const targetH = 150;

          // Берём центральную часть снимка — пропорции не важны
          const scale = Math.max(targetW / image.width, targetH / image.height);
          const drawW = targetW / scale;
          const drawH = targetH / scale;
          const sx = (image.width - drawW) / 2;
          const sy = (image.height - drawH) / 2;

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, sx, sy, drawW, drawH, 0, 0, targetW, targetH);

          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };

        image.onerror = () => reject(new Error('Не удалось прочитать фото'));
        image.src = reader.result;
      };

      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
  }

  /** Миниатюра в редакторе краски. */
  function renderRecipePhoto(url) {
    const preview = $('#recipePhotoPreview');
    const del = $('#btnRecipePhotoDel');
    if (!preview) return;

    if (url) {
      preview.innerHTML = `<img src="${esc(url)}" alt="Фото краски" loading="lazy">`;
      if (del) del.classList.remove('hidden');
    } else {
      preview.innerHTML = '<span class="muted">нет фото</span>';
      if (del) del.classList.add('hidden');
    }
  }

  async function uploadRecipePhoto(file) {
    if (!state.editingRecipe) return;

    try {
      const dataUrl = await cropRecipePhoto(file);

      await api('/api/recipes/' + state.editingRecipe.id + '/photo', {
        method: 'POST',
        body: { file: dataUrl }
      });

      await loadRecipes();

      const fresh = state.recipes.find((row) => row.id === state.editingRecipe.id);
      state.editingRecipe = fresh || state.editingRecipe;

      renderRecipePhoto(fresh ? fresh.photo : null);
      renderRecipesRef();
      toast('Фото сохранено');
    } catch (error) {
      toast(error.message);
    }
  }

  async function removeRecipePhoto() {
    if (!state.editingRecipe) return;

    try {
      await api('/api/recipes/' + state.editingRecipe.id + '/photo', { method: 'DELETE' });
      await loadRecipes();

      const fresh = state.recipes.find((row) => row.id === state.editingRecipe.id);
      state.editingRecipe = fresh || state.editingRecipe;

      renderRecipePhoto(null);
      renderRecipesRef();
      toast('Фото убрано');
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

  /** Журнал входов (видит только администратор). */
async function loadLogins() {
  const host = $('#loginsList');
  if (!host) return;

  host.innerHTML = '<div class="spinner">Загрузка…</div>';

  try {
    const data = await api('/api/logins?limit=200');
    const list = data.logins || [];

    const counter = $('#loginsCount');
    if (counter) counter.textContent = list.length ? `записей: ${list.length}` : '';

    if (!list.length) {
      host.innerHTML = '<div class="empty-line">Пока никто не заходил</div>';
      return;
    }

    host.innerHTML = `
      <table class="grid">
        <thead><tr><th>Когда</th><th>Кто</th><th>Логин</th><th>Итог</th><th>IP</th><th>Устройство</th></tr></thead>
        <tbody>
          ${list.map((row) => `
            <tr>
              <td class="mono">${esc(new Date(row.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }))}</td>
              <td>${esc(row.name || '—')}</td>
              <td class="code-cell">${esc(row.login || '—')}</td>
              <td>${row.result === 'ok' ? '<span class="login-ok">вошёл</span>' : '<span class="login-fail">отказ</span>'}</td>
              <td class="mono muted">${esc(row.ip || '—')}</td>
              <td class="muted login-agent">${esc(shortAgent(row.agent))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
  } catch (error) {
    host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
  }
}

/** Короткое описание браузера и системы. */
function shortAgent(agent) {
  const text = String(agent || '');
  if (!text) return '—';

  const browser = /Edg\//.test(text) ? 'Edge'
    : /OPR\//.test(text) ? 'Opera'
    : /Chrome\//.test(text) ? 'Chrome'
    : /Firefox\//.test(text) ? 'Firefox'
    : /Safari\//.test(text) ? 'Safari'
    : 'браузер';

  const system = /Android/.test(text) ? 'Android'
    : /iPhone|iPad/.test(text) ? 'iOS'
    : /Windows/.test(text) ? 'Windows'
    : /Mac OS/.test(text) ? 'macOS'
    : /Linux/.test(text) ? 'Linux'
    : '';

  return system ? `${browser} · ${system}` : browser;
}

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
                <td data-label="ФИО">${esc(user.full_name)}</td>
                <td class="muted" data-label="Логин">${esc(user.login)}</td>
                <td data-label="Роль">${esc(roleLabel(user))}${user.is_workstation ? ' <span class="muted">(общий вход)</span>' : ''}</td>
                <td data-label="ПИН-код">${user.role === 'master' && !user.is_workstation && user.specialty !== 'bodyworker'
                  ? `<button class="btn btn-outline btn-sm" data-pin-user="${user.id}"
                             data-pin-name="${esc(user.full_name)}">${user.pin_set ? 'Сменить ПИН' : 'Задать ПИН'}</button>`
                  : '<span class="muted">—</span>'}</td>
                <td data-label="Статус">${user.active ? 'работает' : '<span class="muted">отключён</span>'}</td>
                <td class="num" data-label=""><button class="btn btn-outline btn-sm" data-edit-user="${user.id}">Изменить</button></td>
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

  /* ---- ТДС: техническая документация на материалы -------------------------- */

  async function loadTds() {
    try {
      const data = await api('/api/tds');
      state.docs = data.docs || [];
    } catch (error) {
      state.docs = [];
    }
  }

  function docsOf(code) {
    return state.docs.filter((doc) => doc.code === code);
  }

  /** Маленькая кнопка «ТДС» в строках материала. */
  function tdsButton(item) {
    const docs = docsOf(item.code);
    if (!docs.length) return '';

    return `<a class="tds-link" href="${esc(docs[0].url)}" target="_blank" rel="noopener"
               title="${esc(docs.map((d) => d.title).join('\n'))}">ТДС ↗</a>`;
  }

  /* ---- ТДС: раздел со справочником документов ------------------------------ */

  const canEditDocs = () => state.user
    && ['admin', 'manager', 'store', 'master'].includes(state.user.role);

  let tdsPicked = null;

  async function loadTdsView(term) {
    const host = $('#tdsList');
    if (!host) return;

    const card = $('#tdsAddCard');
    if (card) card.classList.toggle('hidden', !canEditDocs());

    host.innerHTML = '<div class="spinner">Загрузка…</div>';

    try {
      await loadTds();

      const query = (term !== undefined ? term : ($('#tdsSearch') ? $('#tdsSearch').value : '')).trim().toLowerCase();

      const docs = state.docs.filter((doc) => {
        if (!query) return true;

        return [doc.name, doc.code, doc.title].filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query) || (looseKey(query).length > 1 && looseKey(value).includes(looseKey(query))));
      });

      if (!docs.length) {
        host.innerHTML = '<div class="empty-line">Документов пока нет</div>';
        return;
      }

      // Группируем по материалу; документы без материала — в «Общие»
      const groups = new Map();

      for (const doc of docs) {
        const isGeneral = !doc.code;
        const key = isGeneral ? '__general__' : doc.code;

        if (!groups.has(key)) {
          groups.set(key, {
            code: isGeneral ? '' : doc.code,
            name: isGeneral ? 'Общие документы (без материала)' : (doc.name || doc.code),
            items: []
          });
        }

        groups.get(key).items.push(doc);
      }

      host.innerHTML = [...groups.values()].map((group) => `
        <div class="tds-group">
          <div class="tds-group-head">
            <span class="code mono">${esc(group.code)}</span>
            <b>${esc(group.name)}</b>
          </div>

          ${group.items.map((doc) => `
            <div class="tds-row">
              <a href="${esc(doc.url)}" target="_blank" rel="noopener">${esc(doc.title)} ↗</a>
              ${canEditDocs() ? `<button class="row-del" data-tds-del="${doc.id}" title="Удалить">×</button>` : ''}
            </div>`).join('')}
        </div>
      `).join('');

      host.querySelectorAll('[data-tds-del]').forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            await api('/api/tds/' + button.dataset.tdsDel, { method: 'DELETE' });
            await loadTdsView();
            toast('Документ удалён');
          } catch (error) {
            toast(error.message);
          }
        });
      });
    } catch (error) {
      host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;
    }
  }

  async function pickTdsMaterial(term) {
    const wrap = $('#tdsMatResults');
    if (!wrap) return;

    if (!term) {
      wrap.classList.add('hidden');
      return;
    }

    try {
      const data = await api('/api/materials?q=' + encodeURIComponent(term));

      wrap.innerHTML = data.materials.slice(0, 8).map((item) => `
        <div class="row" data-tds-pick="${esc(item.code)}">
          <span class="code">${esc(item.code)}</span>
          <span class="name">${esc(item.name)}</span>
        </div>
      `).join('') || '<div class="row" style="cursor:default">Ничего не найдено</div>';

      wrap.classList.remove('hidden');

      wrap.querySelectorAll('[data-tds-pick]').forEach((row) => {
        row.addEventListener('click', () => {
          const item = data.materials.find((m) => m.code === row.dataset.tdsPick);
          tdsPicked = item;

          if ($('#tdsPicked')) {
            $('#tdsPicked').textContent = `${item.code} — ${item.name}`;
          }

          if ($('#tdsMatSearch')) $('#tdsMatSearch').value = item.name;
          wrap.classList.add('hidden');

          if (!$('#tdsTitle').value) {
            $('#tdsTitle').value = 'TDS ' + item.name;
          }
        });
      });
    } catch (error) {
      wrap.classList.add('hidden');
    }
  }

  /** Сообщение прямо в форме: чтобы не гадать, почему «ничего не происходит». */
  function tdsSay(text, isError = true) {
    const box = $('#tdsMessage');
    if (!box) return;

    box.textContent = text || '';
    box.classList.toggle('form-message-error', Boolean(text) && isError);
    box.classList.toggle('form-message-ok', Boolean(text) && !isError);
  }

  /** Если материал не выбран из подсказок — ищем его по введённому тексту. */
  async function resolveTdsMaterial(text) {
    const query = String(text || '').trim();
    if (!query) return null;

    try {
      const data = await api('/api/materials?q=' + encodeURIComponent(query));
      const list = data.materials || [];
      if (!list.length) return null;

      const upper = query.toUpperCase();
      return list.find((m) => m.code.toUpperCase() === upper) || list[0];
    } catch (error) {
      return null;
    }
  }

  async function addTdsLink() {
    const materialText = $('#tdsMatSearch') ? $('#tdsMatSearch').value.trim() : '';

    // Материал не обязателен: без него документ попадёт в «Общие»
    if (!tdsPicked && materialText) {
      const found = await resolveTdsMaterial(materialText);

      if (!found) {
        tdsSay('Материал не найден. Очистите поле «Материал», чтобы добавить документ в общие');
        return;
      }

      tdsPicked = found;
    }

    tdsSay('');

    const title = $('#tdsTitle').value.trim();
    const url = $('#tdsUrl').value.trim();
    const fileInput = $('#tdsFile');
    const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

    if (!title) {
      toast('Укажите название документа');
      return;
    }

    if (!file && !url) {
      toast('Дайте ссылку или выберите файл');
      return;
    }

    const button = $('#btnAddTds');
    if (button) {
      button.disabled = true;
      button.textContent = file ? 'Загружаю…' : 'Добавляю…';
    }

    try {
      if (file) {
        // Файл читаем в браузере и отправляем как данные — сервер сохранит его у себя
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
          reader.readAsDataURL(file);
        });

        await api('/api/tds/file', {
          method: 'POST',
          body: { code: tdsPicked ? tdsPicked.code : '', title, file: dataUrl }
        });
      } else {
        await api('/api/tds', { method: 'POST', body: { code: tdsPicked ? tdsPicked.code : '', title, url } });
      }

      tdsPicked = null;
      $('#tdsMatSearch').value = '';
      $('#tdsTitle').value = '';
      $('#tdsUrl').value = '';
      $('#tdsPicked').textContent = '';
      if (fileInput) fileInput.value = '';
      if ($('#tdsFileName')) $('#tdsFileName').textContent = '';

      await loadTdsView();
      toast(file ? 'Файл загружен и привязан к материалу' : 'Документ добавлен');
    } catch (error) {
      toast(error.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Добавить';
      }
    }
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

  /** На телефоне места мало: показываем «Фамилия И.» и уводим лишние кнопки в меню. */
  function layoutHeader() {
    const user = state.user;
    if (!user) return;

    const name = $('#userName');
    const full = String(user.full_name || '');
    const parts = full.split(/\s+/).filter(Boolean);
    const mobile = isMobile();

    if (name) {
      name.textContent = mobile && parts.length > 1
        ? parts[0] + ' ' + parts[1].charAt(0) + '.'
        : full;
    }

    // Кнопки «Установить», «Пароль» и «Выйти» теперь живут в меню пользователя,
    // переставлять их между шапкой и меню больше не нужно
  }

  function applyRole() {
    const user = state.user;

    layoutHeader();
    const badge = $('#userRole');
    badge.textContent = roleLabel(user);
    badge.className = 'role-badge ' + user.role;

    $('#btnNewOrder').classList.toggle('hidden', !isManager());
    $('#navUsers').classList.toggle('hidden', user.role !== 'admin');
    if ($('#navLogins')) $('#navLogins').classList.toggle('hidden', user.role !== 'admin');
    if ($('#btnAnnounceUpdate')) $('#btnAnnounceUpdate').classList.toggle('hidden', user.role !== 'admin');

    if ($('#navClients')) $('#navClients').classList.toggle('hidden', user.role === 'master');

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
      button.addEventListener('click', () => {
        const target = button.dataset.view;

        if (typeof uiMode === 'function' && uiMode() === 'desk') {
          if (target === 'home') { minimizeAllDeskWindows(); return; }

          openDeskWindow(target);
          return;
        }

        deskOpen(target);
      });
    });

    /* Меню в шапке: «Ещё» и меню пользователя */
    const moreButton = $('#btnMore');
    const moreMenu = $('#moreMenu');
    const userButton = $('#btnUser');
    const userDropdown = $('#userDropdown');

    const closeMenus = () => {
      if (moreMenu) moreMenu.classList.add('hidden');
      if (userDropdown) userDropdown.classList.add('hidden');
    };

    /**
     * На телефоне список открываем во всю ширину экрана под кнопкой,
     * чтобы он не уезжал вбок и не обрезался снизу.
     */
    const placeMenu = (menu, anchor) => {
      menu.removeAttribute('style');

      if (!anchor || window.innerWidth > 780) return;

      const rect = anchor.getBoundingClientRect();
      const top = Math.round(rect.bottom + 6);
      const room = window.innerHeight - top - 10;

      menu.style.position = 'fixed';
      menu.style.left = '8px';
      menu.style.right = '8px';
      menu.style.width = 'auto';
      menu.style.minWidth = '0';
      menu.style.top = top + 'px';
      menu.style.maxHeight = Math.max(140, room) + 'px';
      menu.style.overflowY = 'auto';
    };

    const toggleMenu = (menu, anchor) => {
      if (!menu) return;

      const willOpen = menu.classList.contains('hidden');
      closeMenus();

      if (willOpen) {
        placeMenu(menu, anchor);
        menu.classList.remove('hidden');
      }
    };

    if (moreButton) {
      moreButton.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleMenu(moreMenu, moreButton);
      });
    }

    if (userButton) {
      userButton.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleMenu(userDropdown, userButton);
      });
    }

    // Пункты меню закрывают его после выбора
    if (moreMenu) {
      moreMenu.addEventListener('click', (event) => {
        if (event.target.closest('.menu-item')) moreMenu.classList.add('hidden');
      });
    }

    if (userDropdown) {
      userDropdown.addEventListener('click', (event) => {
        if (event.target.closest('.menu-item')) userDropdown.classList.add('hidden');
      });
    }

    document.addEventListener('click', (event) => {
      if (event.target.closest('.nav-more') || event.target.closest('.user-menu')) return;
      closeMenus();
    });

    // Прокрутка и поворот экрана: место меню могло устареть
    window.addEventListener('resize', closeMenus);
    window.addEventListener('scroll', closeMenus, { passive: true });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenus();
        setFocusMode(false);
      }

      // F — развернуть списание, если открыта его вкладка
      if ((event.key === 'f' || event.key === 'F' || event.key === 'а' || event.key === 'А')
          && !event.ctrlKey && !event.metaKey && !event.altKey
          && !/input|textarea|select/i.test(document.activeElement.tagName)
          && state.orderTab === 'materials') {
        setFocusMode(true);
      }
    });


    $('#btnLogout').addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch (error) { /* всё равно уходим */ }
      location.href = '/login.html';
    });

    $('#btnLock').addEventListener('click', lockWorkstation);

    $('#btnPassword').addEventListener('click', openPasswordModal);

    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);

    if ($('#btnLoginsRefresh')) $('#btnLoginsRefresh').addEventListener('click', loadLogins);
    if ($('#btnAndroidApp')) $('#btnAndroidApp').addEventListener('click', () => { window.open('/downloads/lonjeron.apk', '_blank'); });

    if ($('#btnAnnounceUpdate')) {
      $('#btnAnnounceUpdate').addEventListener('click', async () => {
        try {
          const res = await api('/api/app/announce', { method: 'POST', body: {} });
          toast('Уведомление об обновлении отправлено' + (res.version ? ' (' + res.version + ')' : ''));
        } catch (error) {
          toast(error.message);
        }
      });
    }

    if ($('#btnNavPrefs')) $('#btnNavPrefs').addEventListener('click', openNavPrefs);

    if ($('#btnDeskPrefsSave')) $('#btnDeskPrefsSave').addEventListener('click', saveDeskPrefs);
    if ($('#btnDeskPrefsCancel')) $('#btnDeskPrefsCancel').addEventListener('click', () => $('#deskPrefsModal').classList.remove('open'));
    if ($('#btnCloseDeskPrefs')) $('#btnCloseDeskPrefs').addEventListener('click', () => $('#deskPrefsModal').classList.remove('open'));
    if ($('#btnDeskPrefsReset')) $('#btnDeskPrefsReset').addEventListener('click', () => {
      $('#deskPrefsList input').forEach((input) => {
        input.checked = DEFAULT_DESK.includes(input.value) && (!input.disabled);
      });
    });
    if ($('#btnNavPrefsSave')) $('#btnNavPrefsSave').addEventListener('click', saveNavPrefs);
    if ($('#btnNavPrefsCancel')) $('#btnNavPrefsCancel').addEventListener('click', () => $('#navPrefsModal').classList.remove('open'));
    if ($('#btnCloseNavPrefs')) $('#btnCloseNavPrefs').addEventListener('click', () => $('#navPrefsModal').classList.remove('open'));

    window.addEventListener('resize', () => { if (typeof sizeDeskLayer === 'function') sizeDeskLayer(); });

    /* Задачи */
    if ($('#btnAddTask')) $('#btnAddTask').addEventListener('click', addTask);

    if ($('#taskTitle')) {
      $('#taskTitle').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') addTask();
      });
    }

    $$('[data-task-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        tasksFilter = button.dataset.taskFilter;
        $$('[data-task-filter]').forEach((item) => item.classList.toggle('active', item === button));
        loadTasks();
      });
    });

    /* Переключатель режима в шапке */
    $$('#btnModeSwitch .mode-seg').forEach((button) => {
      button.addEventListener('click', () => setUiMode(button.dataset.mode));
    });

    /* Поиск с рабочего стола */
    const deskInput = $('#deskSearch');

    if (deskInput) {
      let deskTimer = null;

      deskInput.addEventListener('input', () => {
        clearTimeout(deskTimer);
        deskTimer = setTimeout(() => deskSearchRun(deskInput.value), 200);
      });

      deskInput.addEventListener('blur', () => {
        setTimeout(() => {
          const panel = $('#deskSearchResults');
          if (panel) panel.classList.add('hidden');
        }, 200);
      });
    }

    /* Фото готовой краски: камера и выбор файла — отдельные кнопки */
    if ($('#btnRecipeCamera')) {
      $('#btnRecipeCamera').addEventListener('click', () => $('#recipeCameraInput').click());
    }

    if ($('#btnRecipeFile')) {
      $('#btnRecipeFile').addEventListener('click', () => $('#recipePhotoInput').click());
    }

    ['#recipeCameraInput', '#recipePhotoInput'].forEach((selector) => {
      const input = $(selector);
      if (!input) return;

      input.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (file) await uploadRecipePhoto(file);
      });
    });

    if ($('#btnRecipePhotoDel')) {
      $('#btnRecipePhotoDel').addEventListener('click', removeRecipePhoto);
    }
    $('#btnClosePassword').addEventListener('click', closePasswordModal);
    $('#btnCancelPassword').addEventListener('click', closePasswordModal);
    $('#btnSavePassword').addEventListener('click', savePassword);

    // «Глаз» в полях пароля: посмотреть, что набрали
    document.querySelectorAll('[data-toggle-password]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.togglePassword);
        if (!input) return;

        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.classList.toggle('is-on', show);
        button.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
        button.title = show ? 'Скрыть пароль' : 'Показать пароль';
      });
    });

    $('#btnNewOrder').addEventListener('click', () => showView('new'));
    $('#btnCancelNew').addEventListener('click', () => {
      clearNewOrderDraft();
      showView('orders');
    });

    let searchTimer = null;
    let searchTouched = false;
    let userTyped = false;

    const searchField = $('#orderSearch');

    // Поле поиска держим «закрытым», пока в него не ткнули: иначе браузер
    // подставляет туда сохранённый логин и список заказов пустеет
    const unlockSearch = () => {
      searchField.removeAttribute('readonly');
      searchField.removeEventListener('focus', unlockSearch);
      searchField.removeEventListener('pointerdown', unlockSearch);
    };

    searchField.addEventListener('focus', unlockSearch);
    searchField.addEventListener('pointerdown', unlockSearch);

    // Настоящий ввод всегда начинается с клавиши или вставки
    searchField.addEventListener('keydown', () => { userTyped = true; });
    searchField.addEventListener('paste', () => { userTyped = true; });

    searchField.addEventListener('input', (event) => {
      // Значение появилось без нажатия клавиш — это автозаполнение, а не поиск
      if (!userTyped) {
        if (event.target.value) {
          event.target.value = '';
          state.orderFilter.q = '';
          loadOrders(true);
        }
        return;
      }

      searchTouched = true;
      clearTimeout(searchTimer);

      const value = event.target.value.trim();
      searchTimer = setTimeout(() => {
        state.orderFilter.q = value;
        loadOrders();
      }, 220);
    });

    // Страховка на первые секунды после входа: браузер нередко пишет логин
    // в первое текстовое поле страницы
    [900, 1800, 3000].forEach((delay) => {
      setTimeout(() => {
        if (!searchTouched && searchField.value) {
          searchField.value = '';
          state.orderFilter.q = '';
          loadOrders(true);
        }
      }, delay);
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

    // Черновик: сохраняем на каждый ввод и при уходе со страницы
    $('#newOrderForm').addEventListener('input', scheduleDraftSave);
    $('#newOrderForm').addEventListener('change', scheduleDraftSave);
    window.addEventListener('beforeunload', saveNewOrderDraft);

    if ($('#btnDraftClear')) {
      $('#btnDraftClear').addEventListener('click', () => {
        clearNewOrderDraft();
        resetNewOrder();
        toast('Черновик очищен');
      });
    }

    $('#btnReport').addEventListener('click', loadReport);

    const clientSearch = $('#clientSearch');

    if (clientSearch) {
      let clientTimer = null;

      clientSearch.addEventListener('input', () => {
        clearTimeout(clientTimer);
        const value = clientSearch.value.trim();
        clientTimer = setTimeout(() => loadClients(value), 220);
      });
    }

    /* ИИ-помощник */
    if ($('#aiFab')) $('#aiFab').addEventListener('click', () => {
      const panel = $('#aiPanel');
      if (panel && !panel.classList.contains('hidden')) aiClose();
      else aiOpen();
    });

    if ($('#aiClose')) $('#aiClose').addEventListener('click', aiClose);

    if ($('#aiForm')) $('#aiForm').addEventListener('submit', (event) => {
      event.preventDefault();
      aiSend($('#aiInput').value);
    });

    if ($('#btnCloseClient')) $('#btnCloseClient').addEventListener('click', closeClient);

    /* Склад: поиск и добавление материала */
    const warehouseSearch = $('#warehouseSearch');

    if (warehouseSearch) {
      let stockTimer = null;

      warehouseSearch.addEventListener('input', () => {
        clearTimeout(stockTimer);
        const value = warehouseSearch.value.trim();
        stockTimer = setTimeout(() => loadWarehouse(value), 220);
      });
    }

    if ($('#btnAddStock')) $('#btnAddStock').addEventListener('click', addStockItem);

    /* Склад: фильтр «только что заканчивается», приход, история */
    if ($('#stockLowOnly')) {
      $('#stockLowOnly').addEventListener('change', () => renderWarehouse());
    }

    if ($('#btnSaveIncoming')) $('#btnSaveIncoming').addEventListener('click', saveIncoming);
    if ($('#btnCancelIncoming')) $('#btnCancelIncoming').addEventListener('click', () => $('#stockIncomingModal').classList.remove('open'));
    if ($('#btnCloseIncoming')) $('#btnCloseIncoming').addEventListener('click', () => $('#stockIncomingModal').classList.remove('open'));
    if ($('#btnCloseHistory')) $('#btnCloseHistory').addEventListener('click', () => $('#stockHistoryModal').classList.remove('open'));

    if ($('#incomingQty')) {
      $('#incomingQty').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') saveIncoming();
      });
    }

    /* Справочники: разделы и поиск внутри раздела */
    document.querySelectorAll('.refs-tab').forEach((button) => {
      button.addEventListener('click', () => selectRefsTab(button.dataset.refs));
    });

    const refWorkSearch = $('#refWorkSearch');

    if (refWorkSearch) {
      refWorkSearch.addEventListener('input', () => {
        refsWorkQuery = refWorkSearch.value;
        renderWorksRef();
      });
    }

    const refRecipeSearch = $('#refRecipeSearch');

    if (refRecipeSearch) {
      refRecipeSearch.addEventListener('input', () => {
        refsRecipeQuery = refRecipeSearch.value;
        renderRecipesRef();
      });
    }

    /* ТДС: поиск по документам, выбор материала и добавление */
    const tdsSearch = $('#tdsSearch');

    if (tdsSearch) {
      let tdsTimer = null;

      tdsSearch.addEventListener('input', () => {
        clearTimeout(tdsTimer);
        tdsTimer = setTimeout(() => loadTdsView(tdsSearch.value), 220);
      });
    }

    const tdsMatSearch = $('#tdsMatSearch');

    if (tdsMatSearch) {
      let pickTimer = null;

      tdsMatSearch.addEventListener('input', () => {
        tdsSay('');
        clearTimeout(pickTimer);
        pickTimer = setTimeout(() => pickTdsMaterial(tdsMatSearch.value.trim()), 220);
      });

      // Enter — взять первый найденный материал из подсказок
      tdsMatSearch.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();

        const first = document.querySelector('#tdsMatResults [data-tds-pick]');
        if (first) first.click();
      });
    }

    if ($('#btnAddTds')) $('#btnAddTds').addEventListener('click', addTdsLink);

    /* Нормы списания: выбор набора, добавление материалов, сохранение */
    const normSearch = $('#normSearch');
    if (normSearch) {
      let normTimer = null;

      normSearch.addEventListener('input', () => {
        clearTimeout(normTimer);
        const value = normSearch.value.trim();
        normTimer = setTimeout(() => pickNormItem(value), 220);
      });
    }

    if ($('#btnNormAdd')) $('#btnNormAdd').addEventListener('click', () => {
      if (!normSearch.value.trim()) {
        toast('Введите код или название материала');
        normSearch.focus();
        return;
      }

      pickNormItem(normSearch.value.trim());
    });

    if ($('#btnNormSave')) $('#btnNormSave').addEventListener('click', saveNormsSet);
    if ($('#btnNormReset')) $('#btnNormReset').addEventListener('click', resetNormsSet);

    /* ТДС: показываем имя выбранного файла */
    const tdsFileInput = $('#tdsFile');

    if (tdsFileInput) {
      tdsFileInput.addEventListener('change', () => {
        const file = tdsFileInput.files && tdsFileInput.files[0];
        const label = $('#tdsFileName');

        if (!label) return;

        if (!file) { label.textContent = ''; return; }

        const size = file.size > 1024 * 1024
          ? (file.size / 1024 / 1024).toFixed(1) + ' МБ'
          : Math.round(file.size / 1024) + ' КБ';

        label.textContent = file.name + ' · ' + size;

        const titleInput = $('#tdsTitle');
        if (titleInput && !titleInput.value) {
          titleInput.value = file.name.replace(/\.[^.]+$/, '');
        }
      });
    }

    document.querySelectorAll('input[name="normScope"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        normsScope = radio.value;
        renderNormsSet();
      });
    });

    const codesBulkButton = $('#btnImportCodes');
    if (codesBulkButton) codesBulkButton.addEventListener('click', importCodes);

    const codesSearch = $('#codesSearch');
    if (codesSearch) {
      let codesTimer = null;

      codesSearch.addEventListener('input', () => {
        clearTimeout(codesTimer);
        const value = codesSearch.value.trim();
        codesTimer = setTimeout(() => loadCodes(value), 220);
      });
    }

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
    const themeButton = $('#btnTheme');
    if (themeButton) {
      themeButton.addEventListener('click', () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        setTheme(dark ? 'light' : 'dark');
      });
    }

    applyStoredTheme();

    const soundButton = document.getElementById('btnSound');

    if (soundButton) {
      soundButton.addEventListener('click', () => {
        const nowOn = document.documentElement.dataset.sound !== 'off';
        setSound(!nowOn);
        if (!nowOn) playPing();
      });
    }

    applyStoredSound();

    // Браузер включает звук только после первого действия пользователя
    const unlockAudio = () => {
      const ctx = ensureAudio();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => { /* не вышло */ });

      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };

    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    setupInstall();
    $('#btnSaveRoleLabels').addEventListener('click', () => saveRoleLabels(false));
    $('#btnResetRoleLabels').addEventListener('click', () => saveRoleLabels(true));

    let layoutTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(layoutHeader, 150);
    });

    bindPhotoButton($('#btnChatPhoto'), $('#chatPhotoInput'), () => 'general', () => fetchChat('general'));

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
      if ($('#lightbox') !== null) $('#lightbox').remove();
    });

    // Фото в переписке открывается крупно по клику
    document.addEventListener('click', (event) => {
      const photo = event.target.closest && event.target.closest('.msg-photo');
      if (photo) openLightbox(photo.src);
    });
  }

  /* ------------------------------------------------------------------------
     ИИ-помощник: чат в углу экрана
     ------------------------------------------------------------------------ */

  let aiHistory = [];
  let aiBusy = false;

  function aiBubble(role, text) {
    const body = $('#aiBody');
    if (!body) return null;

    const bubble = document.createElement('div');
    bubble.className = 'ai-msg ' + (role === 'user' ? 'ai-msg-user' : 'ai-msg-bot');
    bubble.textContent = text;
    body.appendChild(bubble);
    body.scrollTop = body.scrollHeight;

    return bubble;
  }

  async function aiOpen() {
    const panel = $('#aiPanel');
    if (!panel) return;

    panel.classList.remove('hidden');
    initVoice();
    $('#aiInput').focus();

    try {
      const status = await api('/api/ai/status');
      const label = $('#aiStatus');

      if (label) {
        label.textContent = status.configured
          ? `осталось ${Math.max(0, status.limit_today - status.used_today)} запросов сегодня`
          : 'не настроен';
      }

      if (!status.configured) {
        aiBubble('bot', 'Помощник ещё не настроен: на сервере нет ключа DeepSeek. Скажите администратору.');
      }
    } catch (error) {
      /* статус не критичен */
    }
  }

  function aiClose() {
    const panel = $('#aiPanel');
    if (panel) panel.classList.add('hidden');
  }

  /** После сохранения краски из чата предлагаем сфотографировать выкрас. */
  function aiOfferPhoto(name) {
    const box = $('#aiProposal');
    const recipe = (state.recipes || []).find((row) => row.name === name);

    if (!box || !recipe) return;

    box.innerHTML = `
      <div class="ai-prop-head">Сфотографировать выкрас?</div>
      <div class="ai-prop-row muted">Фото поможет узнать цвет при списании.</div>
      <div class="ai-prop-actions">
        <button class="btn btn-primary btn-sm" id="aiPhotoCamera">📷 Камера</button>
        <button class="btn btn-outline btn-sm" id="aiPhotoFile">🖼 Файл</button>
        <button class="btn btn-outline btn-sm" id="aiPhotoLater">Позже</button>
      </div>
    `;

    box.classList.remove('hidden');

    const openWith = (inputSelector) => {
      box.classList.add('hidden');
      box.innerHTML = '';
      aiClose();

      openRecipeEditor(recipe);

      const input = $(inputSelector);
      if (input) input.click();
    };

    $('#aiPhotoCamera').addEventListener('click', () => openWith('#recipeCameraInput'));
    $('#aiPhotoFile').addEventListener('click', () => openWith('#recipePhotoInput'));

    $('#aiPhotoLater').addEventListener('click', () => {
      box.classList.add('hidden');
      box.innerHTML = '';
    });
  }

  function aiRenderProposal(proposal) {
    const box = $('#aiProposal');
    if (!box) return;

    // Новая готовая краска из диктовки
    if (proposal && proposal.kind === 'recipe') {
      box.innerHTML = `
        <div class="ai-prop-head">Новая краска: ${esc(proposal.name)}</div>
        ${proposal.mixes.map((mix) => `
          <div class="ai-prop-row">
            <span>${esc(mix.name)}</span>
            <span class="mono">${qty(mix.amount)} г</span>
          </div>`).join('')}
        <div class="ai-prop-row ai-prop-total">
          <span>Всего</span>
          <span class="mono">${qty(proposal.base)} г</span>
        </div>
        <div class="ai-prop-actions">
          <button class="btn btn-primary btn-sm" id="aiSaveRecipe">Сохранить краску</button>
          <button class="btn btn-outline btn-sm" id="aiCancel">Отмена</button>
        </div>
      `;

      box.classList.remove('hidden');

      $('#aiCancel').addEventListener('click', () => {
        box.classList.add('hidden');
        box.innerHTML = '';
      });

      $('#aiSaveRecipe').addEventListener('click', async () => {
        const button = $('#aiSaveRecipe');
        button.disabled = true;
        button.textContent = 'Сохраняю…';

        try {
          await api('/api/recipes', {
            method: 'POST',
            body: { name: proposal.name, base: proposal.base, unit: 'г', mixes: proposal.mixes }
          });

          state.recipes = (await api('/api/recipes')).recipes;

          box.classList.add('hidden');
          box.innerHTML = '';
          aiBubble('bot', `Готовая краска «${proposal.name}» сохранена.`);

          // Сразу предлагаем сфотографировать выкрас
          aiOfferPhoto(proposal.name);
        } catch (error) {
          aiBubble('bot', 'Не получилось: ' + error.message);
          button.disabled = false;
          button.textContent = 'Сохранить краску';
        }
      });

      return;
    }

    if (!proposal || !proposal.items || !proposal.items.length) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    box.innerHTML = `
      <div class="ai-prop-head">
        Заказ ${esc(proposal.number)} · ${esc(proposal.plate)}
      </div>
      ${proposal.items.map((item) => `
        <div class="ai-prop-row">
          <span>${esc(item.name)}</span>
          <span class="mono">${qty(item.qty)} ${esc(item.unit)}</span>
        </div>`).join('')}
      <div class="ai-prop-actions">
        <button class="btn btn-primary btn-sm" id="aiConfirm">Списать</button>
        <button class="btn btn-outline btn-sm" id="aiCancel">Отмена</button>
      </div>
    `;

    box.classList.remove('hidden');

    $('#aiCancel').addEventListener('click', () => {
      box.classList.add('hidden');
      box.innerHTML = '';
    });

    $('#aiConfirm').addEventListener('click', async () => {
      const button = $('#aiConfirm');
      button.disabled = true;
      button.textContent = 'Списываю…';

      try {
        for (const item of proposal.items) {
          await api(`/api/orders/${proposal.order_id}/materials`, {
            method: 'POST',
            body: { code: item.code, name: item.name, unit: item.unit, qty: item.qty, kind: item.kind }
          });
        }

        box.classList.add('hidden');
        box.innerHTML = '';
        aiBubble('bot', 'Списано. Обновите заказ, чтобы увидеть строки.');

        if (state.order && Number(state.order.id) === Number(proposal.order_id)) {
          const fresh = await api('/api/orders/' + proposal.order_id);
          state.order = fresh.order;
          renderOrder();
        }
      } catch (error) {
        aiBubble('bot', 'Не получилось: ' + error.message);
        button.disabled = false;
        button.textContent = 'Списать';
      }
    });
  }

  /* ------------------------------------------------------------------------
     Голосовой ввод: распознавание речи прямо в браузере
     ------------------------------------------------------------------------ */

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  let voice = null;
  let voiceText = '';

  function voiceSupported() {
    return Boolean(SpeechRecognition);
  }

  function voiceButtonMark(active) {
    const button = $('#aiMic');
    if (!button) return;

    button.classList.toggle('ai-mic-on', Boolean(active));
    button.title = active ? 'Остановить' : 'Говорить';
  }

  let voiceStarted = false;
  let voiceBroken = false;
  let voiceWatchdog = null;
  let voiceHintShown = false;

  /** Opera отдаёт кнопку, но сервис распознавания в неё не встроен. */
  function voiceExplain() {
    if (voiceHintShown) return;
    voiceHintShown = true;

    aiBubble('bot', [
      'В этом браузере распознавание речи не работает. Так устроена Opera: кнопка есть, а сервис распознавания в неё не встроен.',
      '',
      'Что делать:',
      '• нажмите Win+H — это голосовой ввод Windows, он печатает в любое поле, включая это;',
      '• или откройте сайт в Chrome либо Edge — там микрофон работает;',
      '• или диктуйте с телефона.'
    ].join('\n'));
  }

  /** Разрешение не выдано — объясняем, куда нажать именно в Edge. */
  function voiceExplainPermission(error) {
    const name = error && error.name ? error.name : 'NotAllowedError';

    const reasons = {
      NotAllowedError: 'браузер запретил доступ к микрофону',
      PermissionDeniedError: 'браузер запретил доступ к микрофону',
      NotFoundError: 'микрофон не найден — проверьте, подключён ли он',
      NotReadableError: 'микрофон занят другой программой',
      SecurityError: 'страница открыта не по https'
    };

    aiBubble('bot', [
      'Доступ к микрофону закрыт: ' + (reasons[name] || name) + '.',
      '',
      'Как открыть в Edge:',
      '1. Нажмите значок замка (или ползунки) слева от адреса сайта.',
      '2. «Разрешения для этого сайта» → Микрофон → Разрешить.',
      '3. Перезагрузите страницу.',
      '',
      'Если значка нет (в установленном приложении он бывает скрыт):',
      '• откройте edge://settings/content/microphone',
      '• в списке «Разрешить» добавьте https://ceh-lonjeron.ru',
      '• уберите сайт из списка «Блокировать», если он там есть.',
      '',
      'Ещё проверьте Windows: Параметры → Конфиденциальность → Микрофон.',
      'Там должны быть включены «Доступ к микрофону», «Разрешить приложениям» и ' +
      '«Разрешить классическим приложениям».'
    ].join('\n'));
  }

  /** Просим доступ к микрофону заранее: так Edge показывает запрос. */
  async function askMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, error: { name: 'SecurityError' } };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => { try { track.stop(); } catch (e) { /* уже остановлен */ } });
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function initVoice() {
    const button = $('#aiMic');
    if (!button) return;

    if (!voiceSupported()) {
      button.classList.add('hidden');
      return;
    }

    button.classList.remove('hidden');

    if (voice) return;

    voice = new SpeechRecognition();
    voice.lang = 'ru-RU';
    voice.interimResults = true;
    voice.continuous = false;
    voice.maxAlternatives = 1;

    voice.addEventListener('start', () => {
      voiceStarted = true;
      if (voiceWatchdog) { clearTimeout(voiceWatchdog); voiceWatchdog = null; }
      voiceButtonMark(true);
    });

    voice.addEventListener('result', (event) => {
      let text = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }

      voiceText = text.trim();

      const input = $('#aiInput');
      if (input) input.value = voiceText;
    });

    voice.addEventListener('end', () => {
      voiceButtonMark(false);
      if (voiceWatchdog) { clearTimeout(voiceWatchdog); voiceWatchdog = null; }
      voiceStarted = false;

      // Снимаем фокус: иначе на телефоне кнопка остаётся подсвеченной
      const mic = $('#aiMic');
      if (mic) mic.blur();

      // Распознали — сразу отправляем, как в голосовом помощнике
      if (voiceText) {
        const text = voiceText;
        voiceText = '';
        if ($('#aiInput')) $('#aiInput').value = '';
        aiSend(text);
      }
    });

    voice.addEventListener('error', (event) => {
      voiceButtonMark(false);

      const mic = $('#aiMic');
      if (mic) mic.blur();

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'permission-denied') {
        voiceBroken = true;
        aiBubble('bot', 'Браузер не дал доступ к микрофону. Нажмите на замок слева от адреса → Микрофон → Разрешить, затем перезагрузите страницу.');
      } else if (event.error === 'no-speech') {
        aiBubble('bot', 'Ничего не услышал, попробуйте ещё раз.');
      } else if (event.error === 'audio-capture') {
        voiceBroken = true;
        aiBubble('bot', 'Микрофон не найден или занят другой программой. Проверьте устройство ввода в Windows.');
      } else if (event.error === 'network') {
        voiceBroken = true;
        aiBubble('bot', 'Распознавание не может связаться с сервисом — похоже, он недоступен из вашей сети.');
      } else {
        aiBubble('bot', 'Распознавание не сработало: ' + event.error + '. Нажмите «Проверить микрофон».');
      }
    });

    button.addEventListener('click', async () => {
      if (voiceBroken) {
        voiceExplain();
        button.blur();
        return;
      }

      if ($('#aiMic').classList.contains('ai-mic-on')) {
        voice.stop();
      } else {
        voiceText = '';
        voiceStarted = false;

        // Сначала явно просим доступ: иначе Edge молча блокирует
        const permission = await askMicPermission();

        if (!permission.ok) {
          voiceBroken = true;
          voiceButtonMark(false);
          voiceExplainPermission(permission.error);
          button.blur();
          return;
        }

        try {
          voice.start();
        } catch (error) {
          voiceBroken = true;
          voiceButtonMark(false);
          voiceExplain();
          button.blur();
          return;
        }

        // Opera молчит: не началось за 2,5 секунды — значит не работает
        if (voiceWatchdog) clearTimeout(voiceWatchdog);
        voiceWatchdog = setTimeout(() => {
          if (voiceStarted) return;

          voiceBroken = true;
          voiceButtonMark(false);

          try { voice.abort(); } catch (error) { /* уже остановлено */ }

          voiceExplain();
        }, 2500);
      }

      // Убираем фокус: иначе на телефоне кнопка остаётся подсвеченной
      button.blur();
    });
  }

  /** Переход по просьбе помощника: заказ, его вкладка или раздел программы. */
  async function aiNavigate(action) {
    try {
      if (action.type === 'view' && action.view) {
        showView(action.view);
        aiClose();
        return;
      }

      if (action.type === 'order' && action.order_id) {
        await openOrder(action.order_id);

        if (action.tab && action.tab !== 'order') {
          selectOrderTab(action.tab);
        }

        aiClose();
      }
    } catch (error) {
      toast(error.message);
    }
  }

  /** Карточка найденных документов: тап — открыть в новой вкладке. */
  function aiRenderDocs(docs) {
    const box = $('#aiProposal');
    if (!box) return;

    if (!docs || !docs.length) return;

    box.innerHTML = `
      <div class="ai-prop-head">Документы</div>
      ${docs.map((doc) => `
        <a class="ai-doc-row" href="${esc(doc.url)}" target="_blank" rel="noopener">
          <span>${esc(doc.title)}</span>
          <span class="ai-doc-open">открыть ↗</span>
        </a>`).join('')}
      <div class="ai-prop-actions">
        <button class="btn btn-outline btn-sm" id="aiDocsClose">Закрыть</button>
      </div>
    `;

    box.classList.remove('hidden');

    const close = $('#aiDocsClose');
    if (close) close.addEventListener('click', () => {
      box.classList.add('hidden');
      box.innerHTML = '';
    });
  }

  async function aiSend(text) {
    if (aiBusy || !text.trim()) return;

    const message = text.trim();
    aiBusy = true;

    const input = $('#aiInput');
    if (input) input.value = '';

    aiBubble('user', message);
    aiRenderProposal(null);

    const thinking = aiBubble('bot', 'Думаю…');
    if (thinking) thinking.classList.add('ai-thinking');

    try {
      const data = await api('/api/ai/chat', {
        method: 'POST',
        body: {
          message,
          history: aiHistory.slice(-8),
          order_id: state.order ? state.order.id : null
        }
      });

      if (thinking) thinking.remove();

      aiBubble('bot', data.reply || 'Готово.');

      aiHistory.push({ role: 'user', content: message });
      aiHistory.push({ role: 'assistant', content: data.reply || '' });

      if (data.proposal) aiRenderProposal(data.proposal);
      if (data.opened) aiNavigate(data.opened);
      if (data.documents) aiRenderDocs(data.documents);
    } catch (error) {
      if (thinking) thinking.remove();
      aiBubble('bot', 'Ошибка: ' + error.message);
    } finally {
      aiBusy = false;
    }
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
      await Promise.all([loadWorks(), loadRecipes(), loadTds()]);
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

    // «Назад» на телефоне: листаем экраны программы, а не выходим на вход
    window.addEventListener('popstate', () => {
      historyRestoring = true;

      try {
        if (state.view !== 'orders') showView('orders');
        pushAppState();
      } finally {
        historyRestoring = false;
      }
    });

    pushAppState();

    applyUiMode();
      applyNavPrefs(currentNavItems());
      startClock();
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
