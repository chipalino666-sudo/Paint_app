'use strict';

/* Рендер полного SVG в PNG ровно по его viewBox. */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9773;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const svgPath = process.argv[2];
  const pngPath = process.argv[3];

  const svg = fs.readFileSync(svgPath, 'utf8');
  const sized = svg.replace('<svg ', '<svg width="991" height="674" ');
  const html = '<html><body style="margin:0;background:#fff">' + sized + '</body></html>';

  const htmlPath = path.join(os.tmpdir(), 'car-full.html');
  fs.writeFileSync(htmlPath, html);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-'));
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;

  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      target = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch (error) { /* ждём */ }
    if (!target) await sleep(300);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 991, height: 674, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + htmlPath.replace(/\\/g, '/') });
  await sleep(1200);

  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 991, height: 674, scale: 1 } });
  fs.writeFileSync(pngPath, Buffer.from(shot.data, 'base64'));

  console.log('рендер:', pngPath);

  ws.close();
  child.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (error) { /* пусто */ }
})();
