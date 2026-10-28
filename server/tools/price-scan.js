'use strict';

/*
 * Собирает цены со страниц провайдеров: открывает их в headless-браузере
 * (сайты рисуют цены скриптами) и печатает строки, где встречается рубль.
 *
 *   node tools/price-scan.js https://site.ru/page ...
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEBUG_PORT = 9334;

const BROWSER_CANDIDATES = [
  process.env.PAINT_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) if (fs.existsSync(candidate)) return candidate;
  throw new Error('Браузер не найден');
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
      socket.addEventListener('error', () => reject(new Error('нет связи с браузером')));
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
  for (let attempt = 0; attempt < 80; attempt++) {
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
  throw new Error('браузер не открыл порт');
}

async function main() {
  const urls = process.argv.slice(2);
  if (!urls.length) {
    console.error('Укажите адреса страниц');
    process.exit(1);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'price-scan-'));
  const child = spawn(findBrowser(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1400',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp = null;

  try {
    cdp = await CDP.connect(await waitForTargets());
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false
    });

    for (const url of urls) {
      console.log('\n=== ' + url + ' ===');

      try {
        await cdp.send('Page.navigate', { url });
        await sleep(5000);

        const result = await cdp.send('Runtime.evaluate', {
          expression: `document.body.innerText`,
          returnByValue: true
        });

        const text = String(result.result.value || '');
        const lines = text.split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 2 && line.length < 200)
          .filter((line) => /₽|руб|\d\s?\d*\s?₽/i.test(line));

        const seen = new Set();
        let printed = 0;

        for (const line of lines) {
          if (seen.has(line)) continue;
          seen.add(line);
          console.log('  ' + line);
          printed++;
          if (printed > 40) break;
        }

        if (!printed) console.log('  (цены не нашлись — возможно, сайт не отдался)');
      } catch (error) {
        console.log('  ошибка: ' + error.message);
      }
    }
  } finally {
    if (cdp) cdp.close();
    child.kill();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (error) { /* занято */ }
  }
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
