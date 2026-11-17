'use strict';

/*
 * Фото к готовой краске: маленькая миниатюра 200x150 (JPEG ~5 КБ).
 *
 * 1. db.js  — колонка photo у recipes
 * 2. server.js — загрузка, удаление и отдача миниатюры
 * 3. app.js — обрезка на клиенте, превью в редакторе и в списках
 *
 *   node tools/patch-recipe-photo.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dbFile = path.join(root, 'server', 'db.js');
const serverFile = path.join(root, 'server', 'server.js');
const appFile = path.join(root, 'server', 'public', 'app.js');
const htmlFile = path.join(root, 'server', 'public', 'index.html');

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, text) => fs.writeFileSync(file, text);

let changed = 0;

/* ---------- 1. db.js: колонка ---------- */

let db = read(dbFile);

if (!db.includes("addColumn('recipes', 'photo'")) {
  const anchor = "addColumn('materials', 'min_stock', 'REAL DEFAULT 0');";

  if (!db.includes(anchor)) {
    console.error('db.js: не нашёл место для колонки');
    process.exit(1);
  }

  db = db.replace(anchor, anchor + "\naddColumn('recipes', 'photo', 'TEXT');");
  write(dbFile, db);
  changed++;
  console.log('db.js: колонка photo');
}

/* ---------- 2. server.js: маршруты ---------- */

let server = read(serverFile);

if (!server.includes('/api/recipes/:id/photo')) {
  const anchor = "  route('PUT', '/api/recipes/:id'";

  if (!server.includes(anchor)) {
    console.error('server.js: не нашёл маршрут изменения рецепта');
    process.exit(1);
  }

  const routes = [
    '/** Фото готовой краски: маленькая миниатюра, хранится файлом. */',
    "route('POST', '/api/recipes/:id/photo', async ({ user, params, body }) => {",
    "  if (!isStaff(user) && user.role !== 'master') throw new ApiError(403, 'Фото может добавить мастер или кладовщик');",
    '',
    "  const recipe = db.prepare('SELECT id, name, photo FROM recipes WHERE id = ?').get(Number(params.id));",
    "  if (!recipe) throw new ApiError(404, 'Краска не найдена');",
    '',
    "  const raw = String(body.file || '');",
    "  const match = /^data:image\\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);",
    '',
    "  if (!match) throw new ApiError(400, 'Ожидается картинка');",
    '',
    '  const data = Buffer.from(match[2], \'base64\');',
    '',
    '  // Миниатюра крошечная: 200x150 jpeg это единицы килобайт',
    '  if (data.length > 400 * 1024) throw new ApiError(400, \'Фото слишком большое\');',
    '',
    "  const ext = match[1] === 'png' ? '.png' : match[1] === 'webp' ? '.webp' : '.jpg';",
    '  const dir = path.join(UPLOAD_DIR, \'recipes\');',
    '',
    '  fs.mkdirSync(dir, { recursive: true });',
    '',
    '  const name = `recipe-${recipe.id}-${Date.now()}${ext}`;',
    '  const file = path.join(dir, name);',
    '',
    '  fs.writeFileSync(file, data);',
    '',
    '  // Старое фото больше не нужно',
    "  if (recipe.photo && recipe.photo !== name) {",
    '    const old = path.join(dir, path.basename(String(recipe.photo)));',
    '    if (fs.existsSync(old)) fs.unlinkSync(old);',
    '  }',
    '',
    "  db.prepare('UPDATE recipes SET photo = ? WHERE id = ?').run(name, recipe.id);",
    '',
    "  return { ok: true, photo: '/api/recipes/photo/' + name };",
    '});',
    '',
    "route('GET', '/api/recipes/photo/:name', async ({ params, res }) => {",
    "  const name = path.basename(String(params.name || ''));",
    '',
    "  if (!/^[\\w.-]+\\.(jpe?g|png|webp)$/i.test(name)) throw new ApiError(404, 'Файл не найден');",
    '',
    '  const file = path.join(UPLOAD_DIR, \'recipes\', name);',
    "  if (!fs.existsSync(file)) throw new ApiError(404, 'Файл не найден');",
    '',
    '  const ext = path.extname(name).toLowerCase();',
    "  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';",
    '  const data = fs.readFileSync(file);',
    '',
    '  res.writeHead(200, {',
    "    'Content-Type': type,",
    "    'Content-Length': data.length,",
    "    'Cache-Control': 'private, max-age=604800'",
    '  });',
    '  res.end(data);',
    '',
    '  return { __raw: true };',
    '});',
    '',
    "route('DELETE', '/api/recipes/:id/photo', async ({ user, params }) => {",
    "  if (!isStaff(user) && user.role !== 'master') throw new ApiError(403, 'Фото может убрать мастер или кладовщик');",
    '',
    "  const recipe = db.prepare('SELECT id, photo FROM recipes WHERE id = ?').get(Number(params.id));",
    "  if (!recipe) throw new ApiError(404, 'Краска не найдена');",
    '',
    '  if (recipe.photo) {',
    '    const file = path.join(UPLOAD_DIR, \'recipes\', path.basename(String(recipe.photo)));',
    '    if (fs.existsSync(file)) fs.unlinkSync(file);',
    '  }',
    '',
    "  db.prepare('UPDATE recipes SET photo = NULL WHERE id = ?').run(recipe.id);",
    '',
    '  return { ok: true };',
    '});',
    '',
    anchor
  ].join('\n');

  server = server.replace(anchor, routes);
  changed++;
  console.log('server.js: маршруты фото');
}

/* отдаём адрес фото в списке красок */
if (!server.includes('photo: recipe.photo')) {
  const out = server.match(/function recipeOut\(row\) \{[\s\S]*?\n\}/);

  if (out) {
    const patched = out[0].replace(
      /(\n\s*)(mixes:)/,
      "$1photo: row.photo ? '/api/recipes/photo/' + row.photo : null,$1$2"
    );

    server = server.replace(out[0], patched);
    changed++;
    console.log('server.js: photo в ответе');
  } else {
    console.log('server.js: recipeOut не найден — проверь ответ вручную');
  }
}

write(serverFile, server);

/* ---------- 3. index.html: блок фото в редакторе ---------- */

let html = read(htmlFile);

if (!html.includes('recipePhotoInput')) {
  const anchor = '      <div class="section-title">Миксы на эту базу</div>';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл раздел миксов');
    process.exit(1);
  }

  const block = [
    '      <div class="recipe-photo-row">',
    '        <div class="recipe-photo-preview" id="recipePhotoPreview"></div>',
    '        <div class="recipe-photo-actions">',
    '          <button type="button" class="btn btn-outline btn-sm" id="btnRecipePhoto">📷 Фото краски</button>',
    '          <button type="button" class="btn btn-danger-outline btn-sm hidden" id="btnRecipePhotoDel">Убрать</button>',
    '          <span class="muted recipe-photo-hint">снимок детали или выкраса — обрежется до миниатюры</span>',
    '        </div>',
    '        <input type="file" id="recipePhotoInput" accept="image/*" capture="environment" class="hidden">',
    '      </div>',
    '',
    anchor
  ].join('\n');

  html = html.replace(anchor, block);
  write(htmlFile, html);
  changed++;
  console.log('index.html: блок фото');
}

/* ---------- 4. app.js ---------- */

let app = read(appFile);

if (!app.includes('cropRecipePhoto')) {
  const anchor = '  async function saveRecipe() {';

  if (!app.includes(anchor)) {
    console.error('app.js: не нашёл saveRecipe');
    process.exit(1);
  }

  const helpers = [
    '  /** Сжимаем фото до миниатюры 200x150: весит единицы килобайт. */',
    '  function cropRecipePhoto(file) {',
    '    return new Promise((resolve, reject) => {',
    '      const reader = new FileReader();',
    '',
    '      reader.onload = () => {',
    '        const image = new Image();',
    '',
    '        image.onload = () => {',
    '          const targetW = 200;',
    '          const targetH = 150;',
    '',
    '          // Берём центральную часть снимка, чтобы не тянуть пропорции',
    '          const scale = Math.max(targetW / image.width, targetH / image.height);',
    '          const drawW = targetW / scale;',
    '          const drawH = targetH / scale;',
    '          const sx = (image.width - drawW) / 2;',
    '          const sy = (image.height - drawH) / 2;',
    '',
    '          const canvas = document.createElement(\'canvas\');',
    '          canvas.width = targetW;',
    '          canvas.height = targetH;',
    '',
    '          const ctx = canvas.getContext(\'2d\');',
    '          ctx.drawImage(image, sx, sy, drawW, drawH, 0, 0, targetW, targetH);',
    '',
    "          resolve(canvas.toDataURL('image/jpeg', 0.72));",
    '        };',
    '',
    "        image.onerror = () => reject(new Error('Не удалось прочитать фото'));",
    '        image.src = reader.result;',
    '      };',
    '',
    "      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));",
    '      reader.readAsDataURL(file);',
    '    });',
    '  }',
    '',
    '  /** Показываем миниатюру в редакторе. */',
    '  function renderRecipePhoto(url) {',
    "    const preview = $('#recipePhotoPreview');",
    "    const del = $('#btnRecipePhotoDel');",
    '    if (!preview) return;',
    '',
    '    if (url) {',
    "      preview.innerHTML = '<img src=\"' + esc(url) + '\" alt=\"Фото краски\" loading=\"lazy\">';",
    "      if (del) del.classList.remove('hidden');",
    '    } else {',
    "      preview.innerHTML = '<span class=\"muted\">нет фото</span>';",
    "      if (del) del.classList.add('hidden');",
    '    }',
    '  }',
    '',
    '  async function uploadRecipePhoto(file) {',
    '    if (!state.editingRecipe) return;',
    '',
    '    try {',
    '      const dataUrl = await cropRecipePhoto(file);',
    '      await api(\'/api/recipes/\' + state.editingRecipe.id + \'/photo\', { method: \'POST\', body: { file: dataUrl } });',
    '',
    '      // Обновляем карточку краски в памяти',
    '      await loadRecipes();',
    '',
    '      const fresh = state.recipes.find((row) => row.id === state.editingRecipe.id);',
    '      state.editingRecipe = fresh || state.editingRecipe;',
    '',
    '      renderRecipePhoto(fresh ? fresh.photo : null);',
    '      renderRecipesRef();',
    '      toast(\'Фото сохранено\');',
    '    } catch (error) {',
    '      toast(error.message);',
    '    }',
    '  }',
    '',
    '  async function removeRecipePhoto() {',
    '    if (!state.editingRecipe) return;',
    '',
    '    try {',
    '      await api(\'/api/recipes/\' + state.editingRecipe.id + \'/photo\', { method: \'DELETE\' });',
    '      await loadRecipes();',
    '',
    '      const fresh = state.recipes.find((row) => row.id === state.editingRecipe.id);',
    '      state.editingRecipe = fresh || state.editingRecipe;',
    '',
    '      renderRecipePhoto(null);',
    '      renderRecipesRef();',
    '      toast(\'Фото убрано\');',
    '    } catch (error) {',
    '      toast(error.message);',
    '    }',
    '  }',
    '',
    anchor
  ].join('\n');

  app = app.replace(anchor, helpers);
  changed++;
  console.log('app.js: обрезка и загрузка фото');
}

write(appFile, app);
console.log('изменений:', changed);
