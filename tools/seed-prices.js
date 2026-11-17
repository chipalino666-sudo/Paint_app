'use strict';

/*
 * Проставляет демонстрационные цены: работы и краски,
 * чтобы в заказах были осмысленные суммы.
 *
 *   node tools/seed-prices.js https://ceh-lonjeron.ru
 */

const BASE = process.argv[2] || 'https://ceh-lonjeron.ru';
const LOGIN = process.env.PAINT_ADMIN || 'seedbot';
const PASS = process.env.PAINT_ADMIN_PASS || 'SeedDemo2026!';

let cookie = null;

async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(BASE + url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });

  for (const line of response.headers.getSetCookie()) {
    const match = /^(psid=[^;]+)/.exec(line);
    if (match) cookie = match[1];
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) throw new Error(`${method} ${url}: ${(data && data.error) || response.status}`);
  return data;
}

// Цены работ: по смыслу — покраска детали дороже подготовки
const WORK_PRICES = {
  'Покраска бампера': 7000,
  'Покраска двери': 8000,
  'Покраска зеркала': 3000,
  'Покраска капота': 12000,
  'Покраска крыла заднего': 7000,
  'Покраска крыла переднего': 7000,
  'Покраска крыши': 10000,
  'Покраска крышки багажника': 8000,
  'Покраска кузова полностью': 60000,
  'Покраска молдинга': 2500,
  'Покраска порога': 5000,
  'Покраска проёма': 4000,
  'Покраска стойки': 4500,
  'Полировка детали': 3500,
  'Полировка кузова': 12000,
  'Снятие / установка детали': 2000,
  'Ремонт бампера (пластик)': 5500,
  'Ремонт вмятины': 4000,
  'Грунтование детали': 3000,
  'Шпатлёвка и подготовка детали': 4500
};

async function main() {
  await api('POST', '/api/login', { login: LOGIN, password: PASS });

  const works = (await api('GET', '/api/works')).works;
  let workCount = 0;

  for (const work of works) {
    const price = WORK_PRICES[work.name];
    if (price === undefined) continue;

    await api('PATCH', `/api/works/${work.id}`, { price });
    workCount += 1;
  }

  console.log('работ с ценой:', workCount);

  // Краски: цена за килограмм, пересчёт идёт по граммам через цену за единицу
  const paintPrices = [
    ['Brulex MIX 110B', 3.2],
    ['Brulex MIX 127B', 3.4],
    ['Brulex MIX 138', 3.1],
    ['Brulex MIX 168', 3.3],
    ['Normex 2K HS 442', 2.8]
  ];

  let paintCount = 0;

  for (const [query, price] of paintPrices) {
    const found = (await api('GET', `/api/materials?q=${encodeURIComponent(query)}`)).materials;
    if (!found.length) continue;

    await api('PATCH', `/api/materials/${encodeURIComponent(found[0].code)}`, { price });
    paintCount += 1;
  }

  console.log('красок с ценой:', paintCount);
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
