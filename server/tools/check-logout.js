'use strict';

/*
 * Проверка выхода: вход → «Выйти» → должны остаться на странице входа,
 * без качелей между программой и окном входа.
 *
 *   node tools/check-logout.js
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 9342;
const BASE = process.env.PAINT_URL || 'http://127.0.0.1:3000';
const BROWSERS = [
  process.env.PAINT_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const login = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin12345' })
  });

  const cookie = /psid=[^;]+/.exec(login.headers.getSetCookie().join(';'))[0];

  const browser = BROWSERS.find((p) => fs.existsSync(p));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'logout-'));

  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* ждём */ }
    if (!target) await sleep(250);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

  let msgId = 0;
  const pending = new Map();

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return result.result ? result.result.value : undefined;
  };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.setCookie', {
      name: 'psid',
      value: /psid=([^;]+)/.exec(cookie)[1],
      domain: '127.0.0.1',
      path: '/'
    });

    await send('Page.navigate', { url: BASE + '/' });
    await sleep(2800);

    const before = await evaluate('location.pathname');

    await evaluate(`(() => {
      const button = document.getElementById('btnLogout');
      if (button) button.click();
      return true;
    })()`);

    // Наблюдаем три секунды: адрес не должен прыгать туда-сюда
    const seen = new Set();

    for (let i = 0; i < 12; i++) {
      await sleep(250);
      seen.add(await evaluate('location.pathname'));
    }

    const after = await evaluate('location.pathname');
    const hasLoginForm = await evaluate('!!document.getElementById("loginForm")');

    console.log('было:', before);
    console.log('стало:', after);
    console.log('форма входа на экране:', hasLoginForm);
    console.log('адреса за 3 секунды:', [...seen].join(' → '));
    console.log(seen.size <= 2 && hasLoginForm ? 'ОК: качелей нет' : 'ПРОБЛЕМА: адрес прыгает');
    // Обратная проверка: с живой сессией окно входа должно вернуть в программу
    const login2 = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: 'admin12345' })
    });

    const cookie2 = /psid=[^;]+/.exec(login2.headers.getSetCookie().join(';'))[0];

    await send('Network.setCookie', {
      name: 'psid',
      value: /psid=([^;]+)/.exec(cookie2)[1],
      domain: '127.0.0.1',
      path: '/'
    });

    await send('Page.navigate', { url: BASE + '/login.html' });
    await sleep(2500);

    const afterLoginPage = await evaluate('location.pathname');
    console.log('вход с живой сессией →', afterLoginPage, afterLoginPage === '/' ? 'ОК: вернул в программу' : 'ПРОБЛЕМА: остался на входе');
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
