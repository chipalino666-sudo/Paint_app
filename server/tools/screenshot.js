'use strict';

/*
 * Снимки экранов через headless-браузер — чтобы проверять внешний вид,
 * а не только ответы API.
 *
 *   node tools/screenshot.js
 *
 * Нужен установленный Edge (или Chrome — путь задаётся через PAINT_BROWSER).
 * Файлы кладутся в server/shots/.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BASE = process.env.PAINT_URL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '..', 'shots');
const DEBUG_PORT = 9333;

const BROWSER_CANDIDATES = [
  process.env.PAINT_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Не найден браузер. Укажите путь в PAINT_BROWSER.');
}

async function login() {
  const response = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: process.env.PAINT_LOGIN || 'admin',
      password: process.env.PAINT_PASS || 'admin12345'
    })
  });

  if (!response.ok) throw new Error('Вход не удался: ' + response.status);

  const raw = response.headers.getSetCookie
    ? response.headers.getSetCookie().join(';')
    : response.headers.get('set-cookie') || '';

  const match = /psid=([^;]+)/.exec(raw);
  if (!match) throw new Error('Сервер не выдал cookie сессии');

  return match[1];
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CDP(socket)));
      socket.addEventListener('error', () => reject(new Error('Не удалось подключиться к браузеру')));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket.close(); } catch (error) { /* уже закрыт */ }
  }
}

async function waitForTargets() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await response.json();
      const page = list.find((target) => target.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (error) {
      /* браузер ещё поднимается */
    }
    await sleep(250);
  }
  throw new Error('Браузер не открыл отладочный порт');
}

let NAME_SUFFIX = '';

async function screenshot(cdp, name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const file = name.replace(/\.png$/, NAME_SUFFIX + '.png');
  fs.writeFileSync(path.join(OUT, file), Buffer.from(result.data, 'base64'));
  console.log('  сохранено: shots/' + file);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result ? result.result.value : undefined;
}

async function main() {
  // PAINT_ANON=1 — снять только страницу входа, без авторизации
  const anon = process.env.PAINT_ANON === '1';
  const token = anon ? null : await login();
  const browser = findBrowser();

  fs.mkdirSync(OUT, { recursive: true });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'paint-shots-'));
  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1000',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp = null;

  try {
    cdp = await CDP.connect(await waitForTargets());

    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    // PAINT_MOBILE=1 — снимаем как на телефоне
    const mobile = process.env.PAINT_MOBILE === '1';
    NAME_SUFFIX = mobile ? '-mobile' : '';

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: mobile ? 390 : 1440,
      height: mobile ? 844 : 1000,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile
    });

    if (!anon) {
      await cdp.send('Network.setCookie', {
        name: 'psid', value: token, domain: '127.0.0.1', path: '/'
      });
    }

    await cdp.send('Page.navigate', { url: BASE + (anon ? '/login.html' : '/') });
    await sleep(2500);

    if (anon) {
      await screenshot(cdp, '00-login.png');
      return;
    }

    // Рабочее место мастеров: сначала экран ПИН-кода
    const locked = await evaluate(cdp, `
      (() => {
        const screen = document.getElementById('pinScreen');
        return screen ? !screen.classList.contains('hidden') : false;
      })()
    `);

    if (locked) {
      await screenshot(cdp, '00-pin.png');

      for (const digit of ['1', '1', '1', '1']) {
        await evaluate(cdp, `document.querySelector('#pinPad button[data-key="${digit}"]').click()`);
        await sleep(150);
      }

      await sleep(2500);
    }

    await screenshot(cdp, '01-orders.png');

    // Карточка первого заказа
    const opened = await evaluate(cdp, `
      (() => {
        const target = document.querySelector('#ordersBody tr') || document.querySelector('.order-card');
        if (!target) return 'empty';
        target.click();
        return 'ok';
      })()
    `);
    await sleep(1800);
    if (opened === 'ok') {
      await screenshot(cdp, '02-order.png');
    } else {
      console.log('  заказов нет — карточка пропущена');
    }

    // Приёмщик должен уметь открыть окно правки
    await evaluate(cdp, `
      (() => {
        const button = document.querySelector('#btnEditOrder');
        if (button) button.click();
        return true;
      })()
    `);
    await sleep(900);
    await screenshot(cdp, '03-edit.png');

    await evaluate(cdp, `
      (() => {
        const button = document.querySelector('#btnCancelEditOrder');
        if (button) button.click();
        return true;
      })()
    `);
    await sleep(400);

    // Справочники
    await evaluate(cdp, `document.querySelector('.nav-btn[data-view="refs"]').click()`);
    await sleep(1500);
    await screenshot(cdp, '04-refs.png');

    // Обсуждения
    await evaluate(cdp, `document.querySelector('.nav-btn[data-view="chat"]').click()`);
    await sleep(1500);
    await screenshot(cdp, '06-chat.png');

    // Сотрудники и окно редактирования
    const hasUsers = await evaluate(cdp, `
      (() => {
        const button = document.querySelector('.nav-btn[data-view="users"]');
        if (!button || button.classList.contains('hidden')) return false;
        button.click();
        return true;
      })()
    `);

    if (hasUsers) {
      await sleep(1500);
      await screenshot(cdp, '07-users.png');

      await evaluate(cdp, `
        (() => {
          const button = document.querySelector('[data-edit-user]');
          if (button) button.click();
          return true;
        })()
      `);
      await sleep(800);
      await screenshot(cdp, '08-user-edit.png');

      await evaluate(cdp, `
        (() => {
          const button = document.querySelector('#btnCancelEditUser');
          if (button) button.click();
          return true;
        })()
      `);
      await sleep(300);
    }

    // Новый заказ
    await evaluate(cdp, `document.querySelector('.nav-btn[data-view="orders"]').click()`);
    await sleep(700);
    const canCreate = await evaluate(cdp, `
      (() => {
        const button = document.querySelector('#btnNewOrder');
        if (!button || button.classList.contains('hidden')) return false;
        button.click();
        return true;
      })()
    `);
    await sleep(900);
    if (canCreate) await screenshot(cdp, '05-new.png');
  } finally {
    if (cdp) cdp.close();
    child.kill();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (error) { /* профиль занят */ }
  }
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
