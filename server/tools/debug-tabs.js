'use strict';

/*
 * Открывает заказ, переключается на вкладку списания и снимает экран.
 *
 *   node tools/debug-tabs.js [materials|photos|history|chat]
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 9340;
const BASE = process.env.PAINT_URL || 'http://127.0.0.1:3000';
const TAB = process.argv[2] || 'materials';
const OUT = path.join(__dirname, '..', 'shots', 'tab-' + TAB + (process.env.PAINT_MOBILE === '1' ? '-mobile' : '') + '.png');

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-'));

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
  const errors = [];

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
      return;
    }

    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
  });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return result.result ? result.result.value : undefined;
  };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: process.env.PAINT_MOBILE === '1' ? 390 : 1440,
      height: process.env.PAINT_MOBILE === '1' ? 844 : 1000,
      deviceScaleFactor: process.env.PAINT_MOBILE === '1' ? 2 : 1,
      mobile: process.env.PAINT_MOBILE === '1'
    });
    await send('Network.setCookie', { name: 'psid', value: /psid=([^;]+)/.exec(cookie)[1], domain: '127.0.0.1', path: '/' });
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(2500);

    await evaluate(`(() => {
      const target = document.querySelector('#ordersBody tr') || document.querySelector('.order-card');
      if (target) target.click();
      return true;
    })()`);
    await sleep(1500);

    await evaluate(`(() => {
      const tab = document.querySelector('.order-tab[data-otab="${TAB}"]');
      if (tab) tab.click();
      return true;
    })()`);
    await sleep(800);

    const state = await evaluate(`JSON.stringify({
      active: document.querySelector('.order-tab.active')?.dataset.otab,
      visiblePanels: [...document.querySelectorAll('.order-panel')].filter(p => !p.classList.contains('hidden')).map(p => p.dataset.panel),
      searchReadonly: document.getElementById('matSearch')?.hasAttribute('readonly'),
      searchValue: document.getElementById('matSearch')?.value
    })`);

    console.log('вкладка:', TAB, '->', state);

    if (process.env.PAINT_TYPE === '1') {
      await evaluate(`(() => {
        const input = document.getElementById('matSearch');
        if (!input) return 'нет поля';
        input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'к', bubbles: true }));
        input.value = 'крас';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'набрали';
      })()`);

      await sleep(900);

      const typed = await evaluate(`JSON.stringify({
        readonly: document.getElementById('matSearch').hasAttribute('readonly'),
        value: document.getElementById('matSearch').value,
        results: document.querySelectorAll('#matResults .row').length,
        resultsVisible: document.getElementById('matResults') ? !document.getElementById('matResults').classList.contains('hidden') : false
      })`);

      console.log('печать в поиске:', typed);
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('снимок:', OUT);

    console.log('ошибки:', errors.length ? errors.join(' | ') : 'нет');
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
