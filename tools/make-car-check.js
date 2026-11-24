'use strict';

/* Проверка: как выглядит присланный SVG в обрезке (вид сбоку и сверху). */

const fs = require('node:fs');
const path = require('node:path');

const src = 'C:\\Users\\Maks\\Downloads\\aaa25df4eb3652974c8e613c2f6f0fea.svg';
const out = path.join(__dirname, '..', 'server', 'shots', 'car-check.html');

const svg = fs.readFileSync(src, 'utf8');

const inner = svg
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

const page = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; background: #fff; font-family: sans-serif; }
  .row { max-width: 390px; }
  .box { border: 1px solid #ccd4e0; border-radius: 10px; margin-bottom: 14px; padding: 6px; }
  svg { width: 100%; height: auto; display: block; }
  .line path { fill: #5a6472; opacity: .75; }
  .pale path { fill: #b9c4d4; opacity: .9; }
  h3 { font-size: 13px; margin: 6px 0; color: #5a6472; }
</style>
</head>
<body>
<div class="row">
  <h3>1. Тёмный вариант, вид сбоку</h3>
  <div class="box"><svg class="line" viewBox="200 38 600 200" preserveAspectRatio="xMidYMid meet">${inner}</svg></div>

  <h3>2. Светлый вариант, вид сбоку</h3>
  <div class="box"><svg class="pale" viewBox="200 38 600 200" preserveAspectRatio="xMidYMid meet">${inner}</svg></div>

  <h3>3. Вид сверху</h3>
  <div class="box"><svg class="line" viewBox="200 235 610 235" preserveAspectRatio="xMidYMid meet">${inner}</svg></div>

  <h3>4. Вся картинка целиком</h3>
  <div class="box"><svg class="line" viewBox="0 0 991 674" preserveAspectRatio="xMidYMid meet">${inner}</svg></div>
</div>
</body>
</html>`;

fs.writeFileSync(out, page);
console.log('страница:', out);
