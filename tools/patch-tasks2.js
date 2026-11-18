'use strict';

/*
 * Доска задач: подключаем таблицу, маршруты, раздел и логику.
 * Код маршрутов и клиента лежит рядом в текстовых файлах — так проще править.
 *
 *   node tools/patch-tasks2.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, text) => fs.writeFileSync(file, text);

let changed = 0;

/* ---------- 1. db.js ---------- */

let db = read(path.join(root, 'server', 'db.js'));

if (!db.includes('CREATE TABLE IF NOT EXISTS tasks')) {
  const anchor = '/* Движения склада: приход, ручная правка остатка, списание */';

  const table = fs.readFileSync(path.join(__dirname, 'tasks-db.txt'), 'utf8').replace(/\r?\n/g, '\n');

  if (!db.includes(anchor)) {
    console.error('db.js: не нашёл место');
    process.exit(1);
  }

  db = db.replace(anchor, table + '\n' + anchor);
  write(path.join(root, 'server', 'db.js'), db);
  changed++;
  console.log('db.js: таблица задач');
}

/* ---------- 2. server.js ---------- */

let server = read(path.join(root, 'server', 'server.js'));

if (!server.includes('/api/tasks')) {
  const anchor = '/** Приход товара: остаток растёт, движение пишется в историю. */';

  if (!server.includes(anchor)) {
    console.error('server.js: не нашёл точку вставки');
    process.exit(1);
  }

  const routes = fs.readFileSync(path.join(__dirname, 'tasks-routes.txt'), 'utf8').replace(/\r?\n/g, '\n');
  server = server.replace(anchor, routes + '\n' + anchor);
  write(path.join(root, 'server', 'server.js'), server);
  changed++;
  console.log('server.js: маршруты задач');
}

/* ---------- 3. index.html ---------- */

let html = read(path.join(root, 'server', 'public', 'index.html'));

if (!html.includes('id="view-tasks"')) {
  const menuAnchor = '<button class="nav-btn menu-item" data-view="stock" id="navStock">Склад</button>';

  if (!html.includes(menuAnchor)) {
    console.error('index.html: не нашёл меню');
    process.exit(1);
  }

  html = html.replace(
    menuAnchor,
    '<button class="nav-btn menu-item" data-view="tasks" id="navTasks">Задачи<span class="nav-badge hidden" id="tasksBadge">0</span></button>\n    ' + menuAnchor
  );

  const view = fs.readFileSync(path.join(__dirname, 'tasks-view.txt'), 'utf8').replace(/\r?\n/g, '\n');
  const viewAnchor = '    <!-- ======================= СПИСОК ЗАКАЗОВ ======================= -->';

  html = html.replace(viewAnchor, view + viewAnchor);

  write(path.join(root, 'server', 'public', 'index.html'), html);
  changed++;
  console.log('index.html: раздел задач');
}

/* ---------- 4. app.js ---------- */

let app = read(path.join(root, 'server', 'public', 'app.js'));

if (!app.includes('function loadTasks')) {
  const anchor = 'async function openOrder(id) {';
  const block = fs.readFileSync(path.join(__dirname, 'tasks-client.txt'), 'utf8').replace(/\r?\n/g, '\n');

  if (!app.includes(anchor)) {
    console.error('app.js: не нашёл openOrder');
    process.exit(1);
  }

  app = app.replace(anchor, () => block + anchor);
  changed++;
  console.log('app.js: логика задач');
}

if (!app.includes("if (name === 'tasks') loadTasks();")) {
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

if (!app.includes("title: 'Задачи'")) {
  app = app.replace(
    "    deskTile({ title: 'Пора заказать', count: lowStock, note: 'склад на минимуме', icon: '🛒', desk: 'stock' }),",
    "    deskTile({ title: 'Задачи', count: taskCount, note: 'дела цеха', icon: '🗒️', desk: 'tasks' }),\n    deskTile({ title: 'Пора заказать', count: lowStock, note: 'склад на минимуме', icon: '🛒', desk: 'stock' }),"
  );
  changed++;
  console.log('app.js: плитка задач');
}

if (!app.includes('let taskCount = 0;')) {
  app = app.replace('  let docs = 0;', '  let docs = 0;\n  let taskCount = 0;');
  changed++;
}

if (!app.includes("api('/api/tasks?status=open')")) {
  app = app.replace(
    "  try { docs = ((await api('/api/tds')).docs || []).length; } catch (error) { /* нет доступа */ }",
    "  try { docs = ((await api('/api/tds')).docs || []).length; } catch (error) { /* нет доступа */ }\n"
      + "  try { const t = await api('/api/tasks?status=open'); taskCount = (t.counts && (t.counts.overdue + t.counts.today)) || t.tasks.length; } catch (error) { /* нет доступа */ }"
  );
  changed++;
  console.log('app.js: счётчик задач');
}

write(path.join(root, 'server', 'public', 'app.js'), app);

/* ---------- 5. Стили ---------- */

const cssFile = path.join(root, 'server', 'public', 'extra.css');
let css = read(cssFile);

if (!css.includes('.task-row')) {
  css += fs.readFileSync(path.join(__dirname, 'tasks-css.txt'), 'utf8').replace(/\r?\n/g, '\n');
  write(cssFile, css);
  changed++;
  console.log('extra.css: стили задач');
}

console.log('изменений:', changed);
