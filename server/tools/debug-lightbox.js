'use strict';

/*
 * Проверяет, открывается ли фото крупным планом.
 *
 *   node tools/debug-lightbox.js
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 9339;
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-'));

  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1440,950', 'about:blank'
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
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
    await send('Network.setCookie', { name: 'psid', value: /psid=([^;]+)/.exec(cookie)[1], domain: '127.0.0.1', path: '/' });
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(3000);

    // Открываем первый заказ
    await evaluate(`(() => {
      const target = document.querySelector('#ordersBody tr') || document.querySelector('.order-card');
      if (target) target.click();
      return true;
    })()`);
    await sleep(2000);

    const photos = await evaluate(`document.querySelectorAll('#orderPhotos img').length`);
    console.log('фото в галерее:', photos);

    if (!photos) {
      console.log('  галерея пуста — нечего открывать');
    } else {
      await evaluate(`document.querySelector('#orderPhotos img').click()`);
      await sleep(600);

      const state = await evaluate(`JSON.stringify({
        lightbox: document.querySelectorAll('.lightbox').length,
        imgSrc: document.querySelector('.lightbox img') ? document.querySelector('.lightbox img').src : null,
        imgWidth: document.querySelector('.lightbox img') ? document.querySelector('.lightbox img').naturalWidth : null,
        display: document.querySelector('.lightbox') ? getComputedStyle(document.querySelector('.lightbox')).display : null,
        zIndex: document.querySelector('.lightbox') ? getComputedStyle(document.querySelector('.lightbox')).zIndex : null
      })`);

      console.log('после клика:', state);

      // ещё раз кликаем по оверлею — должен закрыться
      await evaluate(`document.querySelector('.lightbox').click()`);
      await sleep(400);
      console.log('после повторного клика оверлеев осталось:', await evaluate(`document.querySelectorAll('.lightbox').length`));
    }

    // Фото в переписке
    const chatPhotos = await evaluate(`document.querySelectorAll('#orderChatMessages .msg-photo').length`);
    console.log('фото в переписке:', chatPhotos);

    if (chatPhotos) {
      await evaluate(`document.querySelector('#orderChatMessages .msg-photo').click()`);
      await sleep(600);

      const chatState = await evaluate(`JSON.stringify({
        lightbox: document.querySelectorAll('.lightbox').length,
        width: document.querySelector('.lightbox img') ? document.querySelector('.lightbox img').naturalWidth : null
      })`);

      console.log('после клика по фото в чате:', chatState);
      await evaluate(`document.getElementById('lightbox') && document.getElementById('lightbox').remove()`);
    }

    console.log('ошибки в консоли:', errors.length ? errors.join(' | ') : 'нет');
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
