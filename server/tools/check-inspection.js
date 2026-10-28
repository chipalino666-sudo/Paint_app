'use strict';

/*
 * Проверка акта осмотра: открыть заказ, вкладку «Осмотр», поставить метку
 * на схеме, дождаться сохранения и убедиться, что после перезагрузки она на месте.
 *
 *   node tools/check-inspection.js
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 9343;
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

  const token = /psid=([^;]+)/.exec(login.headers.getSetCookie().join(';'))[1];

  const browser = BROWSERS.find((p) => fs.existsSync(p));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-'));

  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1000', 'about:blank'
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    return result.result ? result.result.value : undefined;
  };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.setCookie', { name: 'psid', value: token, domain: '127.0.0.1', path: '/' });
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(2800);

    // Открываем первый заказ
    await evaluate(`(() => { const card = document.querySelector('#ordersBody tr'); if (card) card.click(); return true; })()`);
    await sleep(1600);

    // Вкладка «Осмотр»
    await evaluate(`(() => { const tab = document.querySelector('[data-otab="inspection"]'); if (tab) tab.click(); return true; })()`);
    await sleep(600);

    const before = await evaluate('document.querySelectorAll(".damage").length');

    console.log('диагностика:', await evaluate(`JSON.stringify({
      orderView: !!document.getElementById('orderBody'),
      box: !!document.getElementById('inspectionBox'),
      svg: document.querySelectorAll('.inspect-svg').length,
      tab: !!document.querySelector('[data-otab="inspection"]'),
      view: (document.querySelector('.view:not(.hidden)') || {}).id,
      cards: document.querySelectorAll('.order-card').length
    })`));

    // Ставим метку на виде сбоку
    await evaluate(`(() => {
      const svg = document.querySelector('.inspect-svg[data-inspect-view="side"]');
      const box = svg.getBoundingClientRect();
      svg.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: box.left + box.width * 0.4,
        clientY: box.top + box.height * 0.5
      }));
      return true;
    })()`);

    await sleep(1400);

    const after = await evaluate('document.querySelectorAll(".damage").length');
    const rows = await evaluate('document.querySelectorAll(".damage-row").length');

    // Перезагружаем и смотрим, сохранилось ли
    await send('Page.reload');
    await sleep(2600);
    await evaluate(`(() => { const card = document.querySelector('#ordersBody tr'); if (card) card.click(); return true; })()`);
    await sleep(1600);
    await evaluate(`(() => { const tab = document.querySelector('[data-otab="inspection"]'); if (tab) tab.click(); return true; })()`);
    await sleep(600);

    const restored = await evaluate('document.querySelectorAll(".damage").length');

    console.log('меток было:', before);
    console.log('меток после клика:', after, '| строк в списке:', rows);
    console.log('меток после перезагрузки:', restored);

    console.log(restored > before ? 'ОК: отметка сохранилась' : 'ПРОБЛЕМА: отметка не сохранилась');
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
