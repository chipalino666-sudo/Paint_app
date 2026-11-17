'use strict';

/*
 * Дополняет демо-заказы работами и материалами, которых не хватило
 * (в первой попытке названия не совпали со справочником).
 *
 *   node tools/fix-demo.js https://ceh-lonjeron.ru
 */

const BASE = process.argv[2] || 'https://ceh-lonjeron.ru';
const LOGIN = process.env.PAINT_ADMIN || 'seedbot';
const PASS = process.env.PAINT_ADMIN_PASS || 'SeedDemo2026!';

class Session {
  constructor() { this.cookie = null; }

  async call(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;

    const response = await fetch(BASE + url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });

    for (const line of response.headers.getSetCookie()) {
      const match = /^(psid=[^;]+)/.exec(line);
      if (match) this.cookie = match[1];
    }

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

    if (!response.ok) {
      throw new Error(`${method} ${url}: ${(data && data.error) || response.status}`);
    }

    return data;
  }

  get(u) { return this.call('GET', u); }
  post(u, b) { return this.call('POST', u, b); }
  patch(u, b) { return this.call('PATCH', u, b); }
}

async function main() {
  const api = new Session();
  await api.post('/api/login', { login: LOGIN, password: PASS });

  const works = (await api.get('/api/works')).works;
  const orders = (await api.get('/api/orders')).orders;

  const findWork = (name) => works.find((w) => w.name === name);

  const findMaterial = async (query) => {
    const found = (await api.get(`/api/materials?q=${encodeURIComponent(query)}`)).materials;
    return found.length ? found[0] : null;
  };

  const plan = {
    K555KK77: {
      works: [],
      paints: [['110B', 350], ['2K HS 442', 200]],
      stuff: [['малярная лента', 2], ['липкая', 5]]
    },
    H464HM: {
      works: [],
      paints: [['127B', 420]],
      stuff: [['маскировочная лента', 3]]
    },
    O123AB99: {
      works: [['Покраска крыла переднего', 1], ['Ремонт вмятины', 1]],
      paints: [],
      stuff: []
    },
    M456HB50: { works: [], paints: [['138', 300]], stuff: [] },
    A888AA01: {
      works: [['Покраска крыши', 1]],
      paints: [['168', 250]],
      stuff: []
    }
  };

  for (const order of orders) {
    const plate = (order.plate || '').toUpperCase();
    const spec = plan[plate];
    if (!spec) continue;

    const full = await api.get(`/api/orders/${order.id}`);
    const detail = full.order;

    if (detail.status === 'closed') {
      console.log(`  ${plate}: закрыт, пропускаем`);
      continue;
    }

    for (const [name, qty] of spec.works) {
      if (detail.works.some((w) => w.name === name)) continue;

      const work = findWork(name);
      if (!work) { console.log(`  ! нет работы ${name}`); continue; }

      await api.post(`/api/orders/${order.id}/works`, { work_id: work.id, qty });
      console.log(`  ${plate}: + работа ${name}`);
    }

    for (const [kind, list] of [['paint', spec.paints], ['material', spec.stuff]]) {
      for (const [query, qty] of list) {
        const material = await findMaterial(query);
        if (!material) { console.log(`  ! нет материала ${query}`); continue; }

        if (detail.materials.some((m) => m.code === material.code)) continue;

        await api.post(`/api/orders/${order.id}/materials`, {
          kind,
          code: material.code,
          name: material.name,
          unit: kind === 'paint' ? 'г' : 'шт',
          qty
        });
        console.log(`  ${plate}: + ${material.name} (${qty})`);
      }
    }
  }

  console.log('готово');
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
