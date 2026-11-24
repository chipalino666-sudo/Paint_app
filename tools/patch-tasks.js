'use strict';

/*
 * Доска задач: дела с датами, напоминаниями и привязкой к заказу.
 *
 * 1. db.js — таблица tasks
 * 2. server.js — маршруты /api/tasks
 * 3. index.html — раздел «Задачи»
 * 4. app.js — список, добавление, отметка, сроки
 *
 *   node tools/patch-tasks.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

let db = read(path.join(root, 'server', 'db.js'));
let server = read(path.join(root, 'server', 'server.js'));
let html = read(path.join(root, 'server', 'public', 'index.html'));
let app = read(path.join(root, 'server', 'public', 'app.js'));

let changed = 0;

/* ---------- 1. Таблица ---------- */

if (!db.includes('CREATE TABLE IF NOT EXISTS tasks')) {
  const anchor = '/* Движения склада: приход, ручная правка остатка, списание */';

  if (!db.includes(anchor)) {
    console.error('db.js: не нашёл место для таблицы');
    process.exit(1);
  }

  const table = [
    '/* Доска задач: общие дела цеха, с датами и напоминаниями */',
    'CREATE TABLE IF NOT EXISTS tasks (',
    '  id          INTEGER PRIMARY KEY,',
    '  title       TEXT NOT NULL,',
    '  note        TEXT,',
    '  due_date    TEXT,',
    '  priority    INTEGER NOT NULL DEFAULT 1,',
    '  done        INTEGER NOT NULL DEFAULT 0,',
    '  order_id    INTEGER,',
    '  owner_id    INTEGER,',
    '  assignee_id INTEGER,',
    '  created_at  TEXT NOT NULL,',
    '  updated_at  TEXT NOT NULL,',
    '  done_at     TEXT',
    ');',
    '',
    'CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(due_date, done);',
    '',
    anchor
  ].join('\n');

  db = db.replace(anchor, table);
  changed++;
  console.log('db.js: таблица задач');
}

fs.writeFileSync(path.join(root, 'server', 'db.js'), db);

/* ---------- 2. Маршруты ---------- */

if (!server.includes('/api/tasks')) {
  const anchor = '/** Приход товара: остаток растёт, движение пишется в историю. */';

  if (!server.includes(anchor)) {
    console.error('server.js: не нашёл точку вставки');
    process.exit(1);
  }

  const routes = [
    '/* ---- Доска задач -------------------------------------------------------- */',
    '',
    'const taskOut = (row) => ({',
    '  id: row.id,',
    '  title: row.title,',
    '  note: row.note || null,',
    '  due_date: row.due_date || null,',
    '  priority: Number(row.priority) || 1,',
    '  done: Boolean(row.done),',
    '  order_id: row.order_id || null,',
    '  assignee_id: row.assignee_id || null,',
    '  assignee: row.assignee || null,',
    '  owner_id: row.owner_id || null,',
    '  created_at: row.created_at,',
    '  done_at: row.done_at || null',
    '});',
    '',
    "route('GET', '/api/tasks', async ({ url }) => {",
    "  const status = str(url.searchParams.get('status'), 20) || 'open';",
    '',
    '  const rows = db.prepare(`',
    '    SELECT t.*, COALESCE(u.full_name, \'\') AS assignee',
    '      FROM tasks t',
    '      LEFT JOIN users u ON u.id = t.assignee_id',
    '     ${status === \'done\' ? \'WHERE t.done = 1\' : \'WHERE t.done = 0\'}',
    '     ORDER BY',
    '       CASE WHEN t.due_date IS NULL OR t.due_date = \'\' THEN 1 ELSE 0 END,',
    '       t.due_date,',
    '       t.priority DESC,',
    '       t.id DESC',
    '     LIMIT 300',
    '  `).all();',
    '',
    '  const counts = db.prepare(`',
    '    SELECT',
    '      SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END) AS open,',
    '      SUM(CASE WHEN done = 0 AND due_date IS NOT NULL AND due_date <> \'\' AND due_date < date(\'now\') THEN 1 ELSE 0 END) AS overdue,',
    '      SUM(CASE WHEN done = 0 AND due_date = date(\'now\') THEN 1 ELSE 0 END) AS today',
    '  ').get();',
    '',
    '  return {',
    '    tasks: rows.map(taskOut),',
    '    counts: {',
    '      open: Number(counts.open) || 0,',
    '      overdue: Number(counts.overdue) || 0,',
    '      today: Number(counts.today) || 0',
    '    }',
    '  };',
    '});',
    '',
    "route('POST', '/api/tasks', async ({ user, body }) => {",
    "  const title = str(body.title, 300);",
    "  if (!title) throw new ApiError(400, 'Напишите, что нужно сделать');",
    '',
    "  const due = str(body.due_date, 20);",
    '  const note = str(body.note, 2000);',
    '  const priority = Math.min(3, Math.max(0, Math.round(toNum(body.priority, 1))));',
    '  const orderId = body.order_id ? Number(body.order_id) : null;',
    '  const assigneeId = body.assignee_id ? Number(body.assignee_id) : null;',
    '  const now = nowISO();',
    '',
    '  const info = db.prepare(`',
    '    INSERT INTO tasks (title, note, due_date, priority, order_id, owner_id, assignee_id, created_at, updated_at)',
    '    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    "  `).run(title, note || null, due || null, priority, orderId, user.id, assigneeId, now, now);",
    '',
    "  audit(user.id, 'create', 'task', null, { text: `Задача: ${title}` });",
    '',
    "  return { id: Number(info.lastInsertRowid) };",
    '});',
    '',
    "route('PATCH', '/api/tasks/:id', async ({ user, params, body }) => {",
    '  const id = Number(params.id);',
    "  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);",
    "  if (!task) throw new ApiError(404, 'Задача не найдена');",
    '',
    '  const sets = [];',
    '  const values = [];',
    '',
    '  if (body.title !== undefined) {',
    "    const title = str(body.title, 300);",
    "    if (!title) throw new ApiError(400, 'Название не может быть пустым');",
    "    sets.push('title = ?'); values.push(title);",
    '  }',
    '',
    "  if (body.note !== undefined) { sets.push('note = ?'); values.push(str(body.note, 2000) || null); }",
    "  if (body.due_date !== undefined) { sets.push('due_date = ?'); values.push(str(body.due_date, 20) || null); }",
    "  if (body.priority !== undefined) { sets.push('priority = ?'); values.push(Math.min(3, Math.max(0, Math.round(toNum(body.priority, 1))))); }",
    "  if (body.assignee_id !== undefined) { sets.push('assignee_id = ?'); values.push(body.assignee_id ? Number(body.assignee_id) : null); }",
    "  if (body.order_id !== undefined) { sets.push('order_id = ?'); values.push(body.order_id ? Number(body.order_id) : null); }",
    '',
    '  if (body.done !== undefined) {',
    '    const done = body.done ? 1 : 0;',
    "    sets.push('done = ?'); values.push(done);",
    "    sets.push('done_at = ?'); values.push(done ? nowISO() : null);",
    '  }',
    '',
    "  if (!sets.length) throw new ApiError(400, 'Ничего не изменилось');",
    '',
    "  sets.push('updated_at = ?'); values.push(nowISO());",
    '  values.push(id);',
    '',
    '  db.prepare(`UPDATE tasks SET ${sets.join(\', \')} WHERE id = ?`).run(...values);',
    '',
    "  audit(user.id, 'change', 'task', id, { text: `Задача: ${task.title}` });",
    '',
    "  return { ok: true };",
    '});',
    '',
    "route('DELETE', '/api/tasks/:id', async ({ user, params }) => {",
    '  const id = Number(params.id);',
    "  const task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(id);",
    "  if (!task) throw new ApiError(404, 'Задача не найдена');",
    '',
    '  db.prepare(\'DELETE FROM tasks WHERE id = ?\').run(id);',
    "  audit(user.id, 'delete', 'task', id, { text: `Удалена задача: ${task.title}` });",
    '',
    '  return { ok: true };',
    '});',
    '',
    anchor
  ].join('\n');

  server = server.replace(anchor, routes);
  changed++;
  console.log('server.js: маршруты задач');
}

fs.writeFileSync(path.join(root, 'server', 'server.js'), server);

/* ---------- 3. Раздел в меню и вьюха ---------- */

if (!html.includes('id="view-tasks"')) {
  const menuAnchor = '<button class="nav-btn menu-item" data-view="stock" id="navStock">Склад</button>';

  if (!html.includes(menuAnchor)) {
    console.error('index.html: не нашёл меню');
    process.exit(1);
  }

  html = html.replace(menuAnchor, '<button class="nav-btn menu-item" data-view="tasks" id="navTasks">Задачи<span class="nav-badge hidden" id="tasksBadge">0</span></button>\n    ' + menuAnchor);

  const viewAnchor = '    <!-- ======================= СПИСОК ЗАКАЗОВ ======================= -->';

  const view = [
    '    <!-- ======================= ЗАДАЧИ ======================= -->',
    '    <section class="view hidden" id="view-tasks">',
    '      <h1 class="page-title">Задачи</h1>',
    '',
    '      <div class="card">',
    '        <div class="card-head">',
    '          <h2>Что нужно сделать</h2>',
    '          <span class="muted">общая доска цеха — с датами и напоминаниями</span>',
    '        </div>',
    '',
    '        <div class="task-add">',
    '          <input type="text" id="taskTitle" data-noshield="1" placeholder="Например: заказать лак 455" autocomplete="off">',
    '          <input type="date" id="taskDue" title="Срок">',
    '          <select id="taskPriority" title="Важность">',
    '            <option value="1">обычная</option>',
    '            <option value="2">важная</option>',
    '            <option value="0">мелочь</option>',
    '          </select>',
    '          <button class="btn btn-primary btn-sm" id="btnAddTask">Добавить</button>',
    '        </div>',
    '',
    '        <div class="task-filters">',
    '          <button class="chip active" data-task-filter="open">Активные</button>',
    '          <button class="chip" data-task-filter="done">Выполненные</button>',
    '        </div>',
    '',
    '        <div id="taskList"></div>',
    '      </div>',
    '    </section>',
    '',
    viewAnchor
  ].join('\n');

  html = html.replace(viewAnchor, view);
  changed++;
  console.log('index.html: раздел задач');
}

fs.writeFileSync(path.join(root, 'server', 'public', 'index.html'), html);

/* ---------- 4. Клиент ---------- */

if (!app.includes('loadTasks')) {
  const anchor = 'async function openOrder(id) {';

  const block = [
    '/* --------------------------------------------------------------------------',
    '   Задачи: общая доска цеха',
    '   -------------------------------------------------------------------------- */',
    '',
    "let tasksFilter = 'open';",
    '',
    'function taskDateLabel(date) {',
    '  if (!date) return { text: \'без срока\', cls: \'\' };',
    '',
    '  const today = new Date();',
    '  today.setHours(0, 0, 0, 0);',
    '',
    '  const due = new Date(date + \'T00:00:00\');',
    '  const diff = Math.round((due - today) / 86400000);',
    '',
    "  const pretty = due.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });",
    '',
    '  if (diff < 0) return { text: pretty + \' · просрочено\', cls: \'late\' };',
    '  if (diff === 0) return { text: \'сегодня\', cls: \'today\' };',
    '  if (diff === 1) return { text: \'завтра\', cls: \'soon\' };',
    '  if (diff <= 7) return { text: pretty, cls: \'soon\' };',
    '',
    '  return { text: pretty, cls: \'\' };',
    '}',
    '',
    'async function loadTasks() {',
    "  const host = $('#taskList');",
    '  if (!host) return;',
    '',
    '  host.innerHTML = \'<div class="spinner">Загрузка…</div>\';',
    '',
    '  try {',
    "    const data = await api('/api/tasks?status=' + encodeURIComponent(tasksFilter));",
    '    const tasks = data.tasks || [];',
    '',
    "    const badge = $('#tasksBadge');",
    '    if (badge) {',
    '      const urgent = (data.counts.overdue || 0) + (data.counts.today || 0);',
    "      badge.textContent = urgent ? String(urgent) : '';",
    "      badge.classList.toggle('hidden', !urgent);",
    '    }',
    '',
    '    if (!tasks.length) {',
    "      host.innerHTML = '<div class=\"empty-line\">' + (tasksFilter === 'done' ? 'Выполненных задач нет' : 'Задач пока нет — добавьте первую сверху') + '</div>';",
    '      return;',
    '    }',
    '',
    '    host.innerHTML = tasks.map((task) => {',
    '      const label = taskDateLabel(task.due_date);',
    '',
    '      return `',
    '        <div class="task-row ${task.done ? \'is-done\' : \'\'}" data-task="${task.id}">',
    '          <button class="task-check ${task.done ? \'checked\' : \'\'}" data-task-toggle="${task.id}" title="Готово">✓</button>',
    '          <div class="task-main">',
    '            <div class="task-title">${esc(task.title)}</div>',
    '            <div class="task-meta">',
    '              <span class="task-date ${label.cls}">${esc(label.text)}</span>',
    '              ${task.priority === 2 ? \'<span class="task-prio">важная</span>\' : \'\'}',
    '              ${task.order_id ? `<button class="task-link" data-task-order="${task.order_id}">к заказу</button>` : \'\'}',
    '              ${task.assignee ? `<span class="muted">${esc(task.assignee)}</span>` : \'\'}',
    '            </div>',
    '          </div>',
    '          <input type="date" class="task-due" value="${task.due_date || \'\'}" data-task-due="${task.id}" title="Срок">',
    '          <button class="row-del" data-task-del="${task.id}" title="Удалить">×</button>',
    '        </div>`;',
    "    }).join('');",
    '',
    "    host.querySelectorAll('[data-task-toggle]').forEach((button) => {",
    '      button.addEventListener(\'click\', async () => {',
    '        const id = button.dataset.taskToggle;',
    '        const row = button.closest(\'.task-row\');',
    '        const isDone = row.classList.contains(\'is-done\');',
    '',
    "        await api('/api/tasks/' + id, { method: 'PATCH', body: { done: !isDone } });",
    '        loadTasks();',
    '        loadDesk();',
    '      });',
    '    });',
    '',
    "    host.querySelectorAll('[data-task-due]').forEach((input) => {",
    '      input.addEventListener(\'change\', async () => {',
    '        const id = input.dataset.taskDue;',
    "        await api('/api/tasks/' + id, { method: 'PATCH', body: { due_date: input.value || null } });",
    '        loadTasks();',
    '        loadDesk();',
    '      });',
    '    });',
    '',
    "    host.querySelectorAll('[data-task-order]').forEach((button) => {",
    '      button.addEventListener(\'click\', () => openOrder(button.dataset.taskOrder));',
    '    });',
    '',
    "    host.querySelectorAll('[data-task-del]').forEach((button) => {",
    '      button.addEventListener(\'click\', async () => {',
    '        if (!confirm(\'Удалить задачу?\')) return;',
    "        await api('/api/tasks/' + button.dataset.taskDel, { method: 'DELETE' });",
    '        loadTasks();',
    '        loadDesk();',
    '      });',
    '    });',
    '  } catch (error) {',
    '    host.innerHTML = `<div class="empty-line">${esc(error.message)}</div>`;',
    '  }',
    '}',
    '',
    'async function addTask() {',
    "  const title = $('#taskTitle').value.trim();",
    "  const due = $('#taskDue').value;",
    "  const priority = Number($('#taskPriority').value) || 1;",
    '',
    '  if (!title) return;',
    '',
    '  try {',
    "    await api('/api/tasks', { method: 'POST', body: { title, due_date: due || null, priority } });",
    '',
    "    $('#taskTitle').value = '';",
    "    $('#taskDue').value = '';",
    '',
    '    await loadTasks();',
    '    await loadDesk();',
    '  } catch (error) {',
    '    toast(error.message);',
    '  }',
    '}',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, () => block);
  changed++;
  console.log('app.js: логика задач');
}

/* ---------- 5. Показ раздела и старт ---------- */

if (app.includes("if (name === 'users') loadUsers();") && !app.includes("if (name === 'tasks') loadTasks();")) {
  app = app.replace(
    "  if (name === 'users') loadUsers();",
    "  if (name === 'users') loadUsers();\n    if (name === 'tasks') loadTasks();"
  );
  changed++;
  console.log('showView: раздел задач');
}

if (!app.includes("$('#btnAddTask')")) {
  app = app.replace(
    "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);",
    [
      "    if ($('#btnUiMode')) $('#btnUiMode').addEventListener('click', toggleUiMode);",
      '',
      '    /* Задачи */',
      "    if ($('#btnAddTask')) $('#btnAddTask').addEventListener('click', addTask);",
      '',
      "    if ($('#taskTitle')) {",
      "      $('#taskTitle').addEventListener('keydown', (event) => {",
      "        if (event.key === 'Enter') addTask();",
      '      });',
      '    }',
      '',
      "    $$('[data-task-filter]').forEach((button) => {",
      "      button.addEventListener('click', () => {",
      '        tasksFilter = button.dataset.taskFilter;',
      "        $$('[data-task-filter]').forEach((item) => item.classList.toggle('active', item === button));",
      '        loadTasks();',
      '      });',
      '    });'
    ].join('\n')
  );
  changed++;
  console.log('app.js: обработчики задач');
}

/* плитки на столе: задачи */
if (app.includes("deskTile({ title: 'Пора заказать'") && !app.includes("title: 'Задачи'")) {
  app = app.replace(
    "    deskTile({ title: 'Пора заказать', count: lowStock, note: 'склад на минимуме', icon: '🛒', desk: 'stock' }),",
    "    deskTile({ title: 'Задачи', count: taskCount, note: 'дела цеха', icon: '🗒️', desk: 'tasks' }),\n    deskTile({ title: 'Пора заказать', count: lowStock, note: 'склад на минимуме', icon: '🛒', desk: 'stock' }),"
  );

  changed++;
  console.log('app.js: плитка задач');
}

if (app.includes('let docs = 0;') && !app.includes('let taskCount = 0;')) {
  app = app.replace('  let docs = 0;', '  let docs = 0;\n  let taskCount = 0;');
  changed++;
}

if (!app.includes("api('/api/tasks?status=open')")) {
  app = app.replace(
    "  try { docs = ((await api('/api/tds')).docs || []).length; } catch (error) { /* нет доступа */ }",
    [
      "  try { docs = ((await api('/api/tds')).docs || []).length; } catch (error) { /* нет доступа */ }",
      "  try { const t = await api('/api/tasks?status=open'); taskCount = (t.counts && (t.counts.overdue + t.counts.today)) || t.tasks.length; } catch (error) { /* нет доступа */ }"
    ].join('\n')
  );
  changed++;
  console.log('app.js: счётчик задач на столе');
}

fs.writeFileSync(path.join(root, 'server', 'public', 'app.js'), app);

/* ---------- 6. Стили ---------- */

const cssFile = path.join(root, 'server', 'public', 'extra.css');
let css = read(cssFile);

if (!css.includes('.task-row')) {
  css += `

/* ---------- Задачи -------------------------------------------------------- */

.task-add {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 4px 0 12px;
}

.task-add input[type="text"] { flex: 1 1 260px; min-width: 0; }
.task-add input[type="date"] { flex: 0 0 auto; }

.task-filters { display: flex; gap: 6px; margin-bottom: 10px; }

.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border-soft);
}

.task-row:last-child { border-bottom: none; }
.task-row.is-done .task-title { text-decoration: line-through; color: var(--ink-soft); }

.task-check {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: transparent;
  font-size: 13px;
  cursor: pointer;
}

.task-check.checked {
  background: linear-gradient(180deg, #34d399, #16a34a);
  border-color: #16a34a;
  color: #fff;
}

.task-main { flex: 1 1 auto; min-width: 0; }
.task-title { font-size: 14px; font-weight: 600; }

.task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 3px;
  font-size: 12px;
  color: var(--ink-soft);
}

.task-date.late { color: var(--red); font-weight: 700; }
.task-date.today { color: var(--amber); font-weight: 700; }
.task-date.soon { color: var(--ink-soft); }

.task-prio {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(220, 38, 38, .12);
  color: var(--red);
  font-weight: 700;
  font-size: 11px;
}

.task-link {
  border: none;
  background: none;
  color: var(--blue);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.task-due {
  flex: 0 0 auto;
  width: 130px;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink-soft);
  font-family: inherit;
  font-size: 12px;
}

@media (max-width: 780px) {
  .task-add input[type="text"] { flex: 1 1 100%; }
  .task-due { width: 116px; }
}
`;
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: стили задач');
}

console.log('изменений:', changed);
