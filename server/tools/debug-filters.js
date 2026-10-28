'use strict';

/*
 * Проверяет фильтры заказов: нажимает каждую вкладку и смотрит,
 * сколько заказов осталось на экране. Заодно смотрит, что отдаёт сервер.
 *
 *   node tools/debug-filters.js
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 9338;
const BASE = process.env.PAINT_URL || 'http://127.0.0.1:3000';
const BROWSERS = [
  process.env.PAINT_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. Что отдаёт сервер на каждый фильтр
  console.log('Сервер:');
  const login = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin12345' })
  });
  const raw = login.headers.getSetCookie ? login.headers.getSetCookie().join(';') : login.headers.get('set-cookie');
  const cookie = /psid=[^;]+/.exec(raw)[0];

  const filters = {
    'Открытые': 'accepted,in_work,ready',
    'Приняты': 'accepted',
    'В работе': 'in_work',
    'Готовы': 'ready',
    'Закрыты': 'closed',
    'Все': ''
  };

  for (const [label, status] of Object.entries(filters)) {
    const url = BASE + '/api/orders' + (status ? `?status=${status}` : '');
    const response = await fetch(url, { headers: { cookie } });
    const data = await response.json();
    console.log(`  ${label.padEnd(10)} -> ${data.orders ? data.orders.length : 'ошибка'}`);
  }

  // 2. Что показывает интерфейс после нажатия вкладок
  const browser = BROWSERS.find((p) => fs.existsSync(p));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'filters-'));

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
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Network.setCookie', { name: 'psid', value: /psid=([^;]+)/.exec(cookie)[1], domain: '127.0.0.1', path: '/' });
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(3000);

    console.log('\nИнтерфейс:');

    const labels = await evaluate(`[...document.querySelectorAll('.chip')].map(c => c.textContent.trim())`);
    console.log('  вкладки:', labels ? labels.join(' | ') : 'не найдены');

    for (const label of (labels || [])) {
      await evaluate(`
        (() => {
          const chip = [...document.querySelectorAll('.chip')].find(c => c.textContent.trim() === ${JSON.stringify(label)});
          if (chip) chip.click();
          return true;
        })()
      `);
      await sleep(1200);

      const state = await evaluate(`JSON.stringify({
        rows: document.querySelectorAll('#ordersBody tr').length,
        cards: document.querySelectorAll('.order-card').length,
        emptyText: (document.querySelector('#ordersEmpty')?.innerText || '').trim().slice(0, 60),
        firstCell: (document.querySelector('#ordersBody tr td')?.innerText || '').trim().slice(0, 30)
      })`);

      console.log(`  «${label}» -> ${state}`);
    }
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
