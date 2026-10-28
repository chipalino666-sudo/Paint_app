'use strict';

/*
 * Быстрая проверка страницы в браузере: ошибки в консоли и наличие элементов.
 *
 *   node tools/debug-page.js http://127.0.0.1:3000/ ".order-card"
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 9336;
const BASE = process.env.PAINT_URL || 'http://127.0.0.1:3000';
const BROWSERS = [
  process.env.PAINT_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTargets() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (error) { /* ждём */ }
    await sleep(250);
  }
  throw new Error('браузер не поднялся');
}

async function main() {
  const url = process.argv[2] || BASE + '/';
  const selector = process.argv[3] || 'body';

  const browser = BROWSERS.find((p) => fs.existsSync(p));
  if (!browser) throw new Error('браузер не найден');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-'));
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });

  const ws = new WebSocket(await waitTargets());
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('нет связи с браузером')), { once: true });
  });

  const pending = new Map();
  let id = 0;

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });

  const errors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || 'исключение');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
    }
  });

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    // логинимся и ставим cookie
    const login = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: process.env.PAINT_LOGIN || 'admin', password: process.env.PAINT_PASSWORD || 'admin12345' })
    });
    const raw = login.headers.getSetCookie ? login.headers.getSetCookie().join(';') : login.headers.get('set-cookie');
    const token = /psid=([^;]+)/.exec(raw)[1];
    await send('Network.setCookie', { name: 'psid', value: token, domain: '127.0.0.1', path: '/' });

    await send('Page.navigate', { url });
    await sleep(3500);

    const result = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        name: document.getElementById('userName')?.textContent, navButtons: [...document.querySelectorAll('#nav .btn')].map(b => b.textContent.trim()), cards: document.querySelectorAll('.order-card').length,
        rows: document.querySelectorAll('#ordersBody tr').length,
        bodyText: (document.getElementById('ordersBody')?.innerText || '').slice(0, 200),
        empty: document.getElementById('ordersEmpty')?.children.length,
        chips: document.querySelectorAll('.chip').length,
        width: window.innerWidth
      })`,
      returnByValue: true
    });

    console.log('  состояние:', result.result.value);
    console.log('  ошибки:', errors.length ? errors.join(' | ') : 'нет');
  } finally {
    try { ws.close(); } catch (e) { /* уже закрыт */ }
    child.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* занято */ }
  }
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
