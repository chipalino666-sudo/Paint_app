'use strict';

/*
 * Фото к готовой краске — вторая часть: маршруты сервера и клиент.
 * (db.js с колонкой photo уже обновлён.)
 *
 *   node tools/patch-recipe-photo2.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverFile = path.join(root, 'server', 'server.js');
const appFile = path.join(root, 'server', 'public', 'app.js');
const htmlFile = path.join(root, 'server', 'public', 'index.html');

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, text) => fs.writeFileSync(file, text);

let changed = 0;

/* ---------- server.js: photo в ответе ---------- */

let server = read(serverFile);

if (!server.includes('photo: row.photo')) {
  const old = "const recipeOut = (row) => ({ ...row, mixes: JSON.parse(row.mixes || '[]') });";

  if (!server.includes(old)) {
    console.error('server.js: не нашёл recipeOut');
    process.exit(1);
  }

  const fresh = "const recipeOut = (row) => ({\n" +
    '  ...row,\n' +
    "  mixes: JSON.parse(row.mixes || '[]'),\n" +
    "  photo: row.photo ? '/api/recipes/photo/' + row.photo : null\n" +
    '});';

  server = server.replace(old, fresh);
  changed++;
  console.log('server.js: photo в ответе');
}

/* ---------- server.js: маршруты фото ---------- */

if (!server.includes('/api/recipes/:id/photo')) {
  const anchor = "route('PUT', '/api/recipes/:id', async ({ user, params, body }) => {";

  if (!server.includes(anchor)) {
    console.error('server.js: не нашёл PUT рецепта');
    process.exit(1);
  }

  const routes = [
    '/** Фото готовой краски: маленькая миниатюра 200x150. */',
    "route('POST', '/api/recipes/:id/photo', async ({ user, params, body }) => {",
    "  if (!isStaff(user) && user.role !== 'master') throw new ApiError(403, 'Фото может добавить мастер или кладовщик');",
    '',
    "  const recipe = db.prepare('SELECT id, name, photo FROM recipes WHERE id = ?').get(Number(params.id));",
    "  if (!recipe) throw new ApiError(404, 'Краска не найдена');",
    '',
    "  const raw = String(body.file || '');",
    '  const match = /^data:image\\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);',
    '',
    "  if (!match) throw new ApiError(400, 'Ожидается картинка');",
    '',
    "  const data = Buffer.from(match[2], 'base64');",
    '',
    '  // Миниатюра крошечная: 200x150 jpeg — единицы килобайт',
    "  if (data.length > 400 * 1024) throw new ApiError(400, 'Фото слишком большое');",
    '',
    "  const ext = match[1] === 'png' ? '.png' : match[1] === 'webp' ? '.webp' : '.jpg';",
    "  const dir = path.join(UPLOAD_DIR, 'recipes');",
    '',
    '  fs.mkdirSync(dir, { recursive: true });',
    '',
    '  const name = `recipe-${recipe.id}-${Date.now()}${ext}`;',
    '  fs.writeFileSync(path.join(dir, name), data);',
    '',
    '  // Старое фото больше не нужно',
    '  if (recipe.photo && recipe.photo !== name) {',
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
    "  const file = path.join(UPLOAD_DIR, 'recipes', name);",
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
    "    const file = path.join(UPLOAD_DIR, 'recipes', path.basename(String(recipe.photo)));",
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

write(serverFile, server);

/* ---------- index.html ---------- */

let html = read(htmlFile);

if (!html.includes('recipePhotoInput')) {
  const anchor = '    <div class="section-title">Миксы на эту базу</div>';

  if (!html.includes(anchor)) {
    console.error('index.html: не нашёл раздел миксов');
    process.exit(1);
  }

  const block = [
    '    <div class="recipe-photo-row">',
    '      <div class="recipe-photo-preview" id="recipePhotoPreview"></div>',
    '',
    '      <div class="recipe-photo-actions">',
    '        <button type="button" class="btn btn-outline btn-sm" id="btnRecipePhoto">📷 Фото краски</button>',
    '        <button type="button" class="btn btn-danger-outline btn-sm hidden" id="btnRecipePhotoDel">Убрать</button>',
    '        <span class="muted recipe-photo-hint">снимок детали или выкраса, обрежется до миниатюры</span>',
    '      </div>',
    '',
    '      <input type="file" id="recipePhotoInput" accept="image/*" capture="environment" class="hidden">',
    '    </div>',
    '',
    anchor
  ].join('\n');

  html = html.replace(anchor, block);
  write(htmlFile, html);
  changed++;
  console.log('index.html: блок фото');
}

console.log('изменений:', changed);
