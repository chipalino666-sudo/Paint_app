'use strict';

/*
 * 1. Задачу закрывать/менять может только её автор (или админ).
 * 2. Кнопка «Снять фото» (камера) в карточке заказа.
 *
 *   node tools/patch-task-and-camera.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverFile = path.join(root, 'server', 'server.js');
const appFile = path.join(root, 'server', 'public', 'app.js');

let changed = 0;

/* ---------------- 1. Сервер: права на задачу ---------------- */

let server = fs.readFileSync(serverFile, 'utf8').replace(/\r\n/g, '\n');

const patchAnchor = "route('PATCH', '/api/tasks/:id', async ({ user, params, body }) => {\n  const id = Number(params.id);\n  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);\n  if (!task) throw new ApiError(404, 'Задача не найдена');";

if (server.includes(patchAnchor) && !server.includes('Задачу закрывает только её автор')) {
  server = server.replace(patchAnchor, [
    "route('PATCH', '/api/tasks/:id', async ({ user, params, body }) => {",
    '  const id = Number(params.id);',
    "  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);",
    "  if (!task) throw new ApiError(404, 'Задача не найдена');",
    '',
    '  // Задачу закрывает только её автор (или администратор)',
    "  const isAdmin = user.role === 'admin';",
    '  const isOwner = Number(task.owner_id) === Number(user.id);',
    '',
    '  if (!isAdmin && !isOwner) {',
    "    throw new ApiError(403, 'Закрыть задачу может только её автор или администратор');",
    '  }',
    ''
  ].join('\n'));

  changed++;
  console.log('server.js: менять задачу может только автор');
}

fs.writeFileSync(serverFile, server);

/* ---------------- 2. Клиент: галочка только у автора ---------------- */

let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

if (app.includes('const canRemove = (task) => me.role === \'admin\'') && !app.includes('canToggle')) {
  app = app.replace(
    "    const canRemove = (task) => me.role === 'admin' || Number(task.owner_id) === Number(me.id);",
    [
      "    const canRemove = (task) => me.role === 'admin' || Number(task.owner_id) === Number(me.id);",
      "    const canToggle = canRemove;"
    ].join('\n')
  );

  app = app.replace(
    '          <button class="task-check ${task.done ? \'checked\' : \'\'}" data-task-toggle="${task.id}" title="Готово">✓</button>',
    [
      '          ${canToggle(task)',
      "            ? `<button class=\"task-check ${task.done ? 'checked' : ''}\" data-task-toggle=\"${task.id}\" title=\"Готово\">✓</button>`",
      "            : `<span class=\"task-check is-locked ${task.done ? 'checked' : ''}\" title=\"Закрывает автор задачи\">✓</span>`}"
    ].join('\n')
  );

  changed++;
  console.log('app.js: галочка только у автора задачи');
}

/* срок меняет тоже автор */
if (app.includes('data-task-due="${task.id}"') && !app.includes('task-due is-locked')) {
  app = app.replace(
    '<input type="date" class="task-due" value="${task.due_date || \'\'}" data-task-due="${task.id}" title="Срок">',
    '${canToggle(task)\n            ? `<input type="date" class="task-due" value="${task.due_date || \'\'}" data-task-due="${task.id}" title="Срок">`\n            : `<span class="task-due is-locked" title="Срок ставит автор задачи">${task.due_date || \'—\'}</span>`}'
  );

  changed++;
  console.log('app.js: срок только у автора');
}

/* ---------------- 3. Кнопка камеры для фото заказа ---------------- */

const photosBlock = [
  '        <div class="actions-row" style="margin-top:12px">',
  '          <button class="btn btn-outline" id="btnOrderPhoto">Добавить фото</button>',
  '          <input type="file" id="orderPhotoInput" accept="image/*" multiple hidden>',
  '',
  '          <button class="btn btn-primary" id="btnOrderCamera">Снять фото</button>',
  '          <input type="file" id="orderCameraInput" accept="image/*" capture="environment" hidden>',
  '        </div>'
].join('\n');

if (!app.includes('id="btnOrderCamera"')) {
  app = app.replace(
    [
      '        <div class="actions-row" style="margin-top:12px">',
      '          <button class="btn btn-outline" id="btnOrderPhoto">Добавить фото</button>',
      '          <input type="file" id="orderPhotoInput" accept="image/*" multiple hidden>',
      '        </div>'
    ].join('\n'),
    photosBlock
  );

  changed++;
  console.log('app.js: кнопка «Снять фото»');
}

if (!app.includes("$('#btnOrderCamera')")) {
  app = app.replace(
    "  function bindOrderPhotos(order) {",
    [
      '  function bindOrderPhotos(order) {'
    ].join('\n')
  );

  // вставляем обработчик камеры внутрь bindOrderPhotos после привязки кнопки
  app = app.replace(
    '    button.addEventListener(\'click\', () => input.click());\n',
    [
      "    button.addEventListener('click', () => input.click());",
      '',
      '    // Сразу камера: на телефоне это быстрее, чем искать файл',
      "    const cameraButton = $('#btnOrderCamera');",
      "    const cameraInput = $('#orderCameraInput');",
      '',
      '    if (cameraButton && cameraInput) {',
      "      cameraButton.addEventListener('click', () => cameraInput.click());",
      '',
      "      cameraInput.addEventListener('change', async () => {",
      '        const files = [...cameraInput.files];',
      "        cameraInput.value = '';",
      '        if (!files.length) return;',
      '',
      "        toast('Загружаем фотографию…');",
      '',
      '        try {',
      '          await uploadPhoto(files[0], { orderId: order.id });',
      '        } catch (error) {',
      '          toast(error.message);',
      '        }',
      '',
      '        await loadOrderPhotos(order.id);',
      '        loadHistory(order.id);',
      '      });',
      '    }',
      ''
    ].join('\n')
  );

  changed++;
  console.log('app.js: обработчик камеры');
}

fs.writeFileSync(appFile, app);

/* ---------------- 4. Стиль заблокированной галочки ---------------- */

const cssFile = path.join(root, 'server', 'public', 'extra.css');
let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

if (!css.includes('.task-check.is-locked')) {
  css += `

/* Задачу закрывает её автор: чужая галочка неактивна */
.task-check.is-locked {
  opacity: .45;
  cursor: default;
}

.task-due.is-locked {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 10px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--grey);
  font-size: 12.5px;
}
`;
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: стиль закрытой галочки');
}

console.log('изменений:', changed);
