'use strict';

/*
 * Мобильные меню: чтобы выпадающие списки не уезжали вбок и не обрезались снизу.
 * Плюс кнопка «Скачать приложение» на странице входа.
 *
 *   node tools/patch-mobile-menus.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'server', 'public');

let changed = 0;

/* ---------- 1. app.js: умное размещение меню ---------- */

const appFile = path.join(publicDir, 'app.js');
let app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');

const oldToggle = [
  '    const toggleMenu = (menu) => {',
  '      if (!menu) return;',
  '',
  '      const willOpen = menu.classList.contains(\'hidden\');',
  '      closeMenus();',
  '      if (willOpen) menu.classList.remove(\'hidden\');',
  '    };'
].join('\n');

const newToggle = [
  '    /**',
  '     * На телефоне список открываем во всю ширину экрана под кнопкой,',
  '     * чтобы он не уезжал вбок и не обрезался снизу.',
  '     */',
  '    const placeMenu = (menu, anchor) => {',
  '      menu.removeAttribute(\'style\');',
  '',
  '      if (!anchor || window.innerWidth > 780) return;',
  '',
  '      const rect = anchor.getBoundingClientRect();',
  '      const top = Math.round(rect.bottom + 6);',
  '      const room = window.innerHeight - top - 10;',
  '',
  '      menu.style.position = \'fixed\';',
  '      menu.style.left = \'8px\';',
  '      menu.style.right = \'8px\';',
  '      menu.style.width = \'auto\';',
  '      menu.style.minWidth = \'0\';',
  '      menu.style.top = top + \'px\';',
  '      menu.style.maxHeight = Math.max(140, room) + \'px\';',
  '      menu.style.overflowY = \'auto\';',
  '    };',
  '',
  '    const toggleMenu = (menu, anchor) => {',
  '      if (!menu) return;',
  '',
  '      const willOpen = menu.classList.contains(\'hidden\');',
  '      closeMenus();',
  '',
  '      if (willOpen) {',
  '        placeMenu(menu, anchor);',
  '        menu.classList.remove(\'hidden\');',
  '      }',
  '    };'
].join('\n');

if (app.includes(oldToggle)) {
  app = app.replace(oldToggle, newToggle);
  changed++;
  console.log('app.js: меню размещается по экрану');
} else if (!app.includes('const placeMenu')) {
  console.error('app.js: не нашёл toggleMenu');
  process.exit(1);
}

app = app.replace('toggleMenu(moreMenu);', 'toggleMenu(moreMenu, moreButton);');
app = app.replace('toggleMenu(userDropdown);', 'toggleMenu(userDropdown, userButton);');

/* меню закрываем при прокрутке и повороте экрана — иначе оно останется висеть */
if (!app.includes('место меню могло устареть')) {
  app = app.replace(
    '    document.addEventListener(\'click\', (event) => {\n      if (event.target.closest(\'.nav-more\') || event.target.closest(\'.user-menu\')) return;\n      closeMenus();\n    });',
    [
      '    document.addEventListener(\'click\', (event) => {',
      '      if (event.target.closest(\'.nav-more\') || event.target.closest(\'.user-menu\')) return;',
      '      closeMenus();',
      '    });',
      '',
      '    // Прокрутка и поворот экрана: место меню могло устареть',
      '    window.addEventListener(\'resize\', closeMenus);',
      '    window.addEventListener(\'scroll\', closeMenus, { passive: true });'
    ].join('\n')
  );

  changed++;
  console.log('app.js: меню закрывается при прокрутке');
}

fs.writeFileSync(appFile, app);

/* ---------- 2. extra.css ---------- */

const cssFile = path.join(publicDir, 'extra.css');
let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');

if (!css.includes('.android-download')) {
  css += `

/* ---------- Кнопка скачивания приложения -------------------------------- */

.android-download {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  margin-top: 12px;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: border-color .15s, background .15s;
}

.android-download:hover {
  border-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 10%, var(--surface-2));
}

.android-download-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  object-fit: contain;
  flex: 0 0 auto;
}

.android-download-sub {
  display: block;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--grey);
  margin-top: 2px;
}

@media (max-width: 780px) {
  .android-download {
    font-size: 13.5px;
    padding: 10px 12px;
  }
}
`;
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: стиль кнопки скачивания');
}

/* ---------- 3. login.html: кнопка «Скачать приложение» ---------- */

const loginFile = path.join(publicDir, 'login.html');
let login = fs.readFileSync(loginFile, 'utf8').replace(/\r\n/g, '\n');

if (!login.includes('android-download')) {
  const anchor = '    <button type="button" class="link-btn" id="installHint">Установить приложение на телефон</button>';

  if (!login.includes(anchor)) {
    console.error('login.html: не нашёл подсказку про установку');
    process.exit(1);
  }

  const button = [
    '    <a class="android-download" href="/downloads/lonjeron.apk" download>',
    '      <img src="/logo.png" alt="" class="android-download-icon">',
    '      <span>',
    '        Скачать приложение',
    '        <span class="android-download-sub">для Android · 45 КБ</span>',
    '      </span>',
    '    </a>',
    '',
    anchor
  ].join('\n');

  login = login.replace(anchor, button);
  fs.writeFileSync(loginFile, login);
  changed++;
  console.log('login.html: кнопка скачивания приложения');
}

/* ---------- 4. Мобильные меню: страховка в CSS ---------- */

if (!css.includes('.menu-mobile-fix')) {
  css += `

/* На телефоне выпадающий список не шире экрана */
.menu-mobile-fix {
  box-sizing: border-box;
}
`;
  fs.writeFileSync(cssFile, css);
  changed++;
  console.log('extra.css: страховка для меню');
}

console.log('изменений:', changed);
