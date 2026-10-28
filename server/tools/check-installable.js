'use strict';

/*
 * Проверяет, можно ли установить сайт как приложение:
 * спрашивает у браузера список причин, по которым установка невозможна.
 *
 *   node tools/check-installable.js https://example.com
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 9337;
const url = process.argv[2] || 'http://127.0.0.1:3000';

const BROWSERS = [
  process.env.PAINT_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
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
  const browser = BROWSERS.find((p) => fs.existsSync(p));
  if (!browser) throw new Error('браузер не найден');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'install-check-'));
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=420,900', 'about:blank'
  ], { stdio: 'ignore' });

  const ws = new WebSocket(await waitTargets());
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('нет связи с браузером')), { once: true });
  });

  const pending = new Map();
  let msgId = 0;

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

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url });
    await sleep(4000);

    const errors = await send('Page.getInstallabilityErrors');
    console.log('\nПричины, по которым установка невозможна:');

    if (!errors.installabilityErrors || !errors.installabilityErrors.length) {
      console.log('  нет — установка должна быть доступна');
    } else {
      errors.installabilityErrors.forEach((item) => {
        console.log(`  • ${item.errorId}: ${item.errorArguments ? JSON.stringify(item.errorArguments) : ''}`);
      });
    }

    const manifest = await send('Page.getAppManifest');
    console.log('\nМанифест:');
    console.log('  адрес:', manifest.url || 'не найден');
    console.log('  ошибки:', (manifest.errors || []).map((e) => e.message).join('; ') || 'нет');
    if (manifest.parsed) {
      console.log('  name:', manifest.parsed.name || '—');
      console.log('  start_url:', manifest.parsed.startUrl || '—');
      console.log('  display:', manifest.parsed.display || '—');
      console.log('  иконок:', (manifest.parsed.icons || []).length);
    }

    const sw = await send('Runtime.evaluate', {
      expression: `(async () => {
        if (!('serviceWorker' in navigator)) return 'serviceWorker не поддерживается';
        const regs = await navigator.serviceWorker.getRegistrations();
        return JSON.stringify({
          registrations: regs.length,
          scope: regs.map(r => r.scope),
          active: regs.map(r => Boolean(r.active)),
          controller: Boolean(navigator.serviceWorker.controller)
        });
      })()`,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('\nService worker:', sw.result.value);
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
