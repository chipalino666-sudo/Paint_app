'use strict';

/*
 * Наполняет сайт демонстрационными данными: сотрудники, заказы, работы,
 * материалы, переписка и фотографии.
 *
 *   node tools/seed-demo.js https://ceh-lonjeron.ru
 *
 * Логин администратора берётся из переменных PAINT_ADMIN / PAINT_ADMIN_PASS,
 * по умолчанию admin / admin12345.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BASE = process.argv[2] || 'https://ceh-lonjeron.ru';
const ADMIN_LOGIN = process.env.PAINT_ADMIN || 'admin';
const ADMIN_PASS = process.env.PAINT_ADMIN_PASS || 'admin12345';
const DEMO_PASS = 'demo12345';

const photosDir = path.join(os.tmpdir(), 'demo-photos');

/** Простая сессия: храним cookie и повторяем его в запросах */
class Session {
  constructor() {
    this.cookie = null;
  }

  async call(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;

    const response = await fetch(BASE + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const setCookie = response.headers.getSetCookie();
    for (const line of setCookie) {
      const match = /^(psid=[^;]+)/.exec(line);
      if (match) this.cookie = match[1];
    }

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = data && data.error ? data.error : `HTTP ${response.status}`;
      const err = new Error(`${method} ${url}: ${message}`);
      err.status = response.status;
      throw err;
    }

    return data;
  }

  get(url) { return this.call('GET', url); }
  post(url, body) { return this.call('POST', url, body); }
  patch(url, body) { return this.call('PATCH', url, body); }

  async login(login, password) {
    await this.post('/api/login', { login, password });
    return this;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureUser(admin, user) {
  try {
    const created = await admin.post('/api/users', {
      login: user.login,
      full_name: user.full_name,
      role: user.role,
      password: DEMO_PASS,
      pin: user.pin
    });

    console.log(`  создан: ${user.full_name} (${user.role})`);
    return created.id;
  } catch (error) {
    if (error.status === 400 && /занят/i.test(error.message)) {
      const list = await admin.get('/api/users');
      const found = list.users.find((u) => u.login === user.login);
      console.log(`  уже есть: ${user.full_name}`);
      return found ? found.id : null;
    }

    throw error;
  }
}

async function main() {
  console.log('=== вход администратора ===');
  const admin = await new Session().login(ADMIN_LOGIN, ADMIN_PASS);
  console.log('  ок');

  console.log('\n=== сотрудники ===');
  const people = [
    { login: 'manager1', full_name: 'Сидорова Анна Викторовна', role: 'manager' },
    { login: 'ivanov', full_name: 'Иванов Пётр Сергеевич', role: 'master', pin: '1234' },
    { login: 'sergeev', full_name: 'Сергеев Алексей Николаевич', role: 'master', pin: '2345' },
    { login: 'kuznetsov', full_name: 'Кузнецов Дмитрий Олегович', role: 'master', pin: '3456' },
    { login: 'body1', full_name: 'Кузнецов Игорь Валентинович', role: 'bodyworker' },
    { login: 'store1', full_name: 'Мартынова Ольга Сергеевна', role: 'store' },
    { login: 'master', full_name: 'Рабочее место маляров', role: 'workstation', password: 'master12345' }
  ];

  const ids = {};

  for (const person of people) {
    ids[person.login] = await ensureUser(admin, person);
  }

  console.log('\n=== справочники ===');
  const works = (await admin.get('/api/works')).works;
  const worksByName = new Map(works.map((w) => [w.name, w]));
  console.log(`  работ: ${works.length}`);

  const pickWork = (name) => {
    const found = worksByName.get(name);
    if (!found) console.log(`  ! нет работы: ${name}`);
    return found;
  };

  // Материалы ищем запросом: в базе 470+ позиций, весь список не отдаётся
  const pickMaterial = async (query) => {
    const found = (await admin.get(`/api/materials?q=${encodeURIComponent(query)}`)).materials;
    if (!found.length) console.log(`  ! нет материала: ${query}`);
    return found.length ? found[0] : null;
  };

  console.log('\n=== заказы ===');

  const orders = [
    {
      car: { plate: 'K555KK77', make: 'Lada', model: 'Granta', color: 'Серебристый', color_code: '570',
        owner_name: 'Петров Игорь Николаевич', owner_phone: '+7 900 123-45-67' },
      master: 'ivanov', status: 'in_work',
      works: [['Покраска капота', 1.5], ['Покраска бампера', 1]],
      paints: [['Краска Brulex MIX 110B', 350], ['Лак Normex 2K HS 442', 200]],
      stuff: [['гидрофобная малярная лента', 2], ['Салфетка липкая', 5]],
      photo: 'car1.jpg',
      chat: 'Капот в работе, завтра второй слой.'
    },
    {
      car: { plate: 'H464HM', make: 'Mercedes', model: 'E class', color: 'Чёрный', color_code: '127',
        owner_name: 'Смирнов Андрей Владимирович', owner_phone: '+7 916 555-11-22' },
      master: 'sergeev', status: 'ready',
      works: [['Покраска двери', 1]],
      paints: [['Краска Brulex MIX 127B', 420]],
      stuff: [['подъемная лента для маскировки', 3]],
      photo: 'car2.jpg',
      chat: 'Дверь готова, можно забирать.'
    },
    {
      car: { plate: 'O123AB99', make: 'Toyota', model: 'Camry', color: 'Белый', color_code: '801',
        owner_name: 'Волков Дмитрий Сергеевич', owner_phone: '+7 903 777-33-44' },
      master: 'kuznetsov', bodyworker: 'body1', status: 'accepted',
      works: [['Покраска крыла переднего', 1], ['Ремонт вмятины', 1]],
      paints: [], stuff: [],
      photo: 'car3.jpg',
      chat: 'Крыло приняли, начинаем в понедельник.'
    },
    {
      car: { plate: 'M456HB50', make: 'Lada', model: 'Vesta', color: 'Синий',
        owner_name: 'Козлов Илья Андреевич', owner_phone: '+7 925 222-66-77' },
      master: 'ivanov', status: 'closed',
      works: [['Покраска капота', 1]],
      paints: [['Краска Brulex MIX 138', 300]],
      stuff: [],
      photo: 'car4.jpg'
    },
    {
      car: { plate: 'K777PT77', make: 'Kia', model: 'Rio', color: 'Красный',
        owner_name: 'Фёдорова Мария Олеговна', owner_phone: '+7 964 888-99-00' },
      master: 'sergeev', status: 'closed',
      works: [['Покраска бампера', 1]],
      paints: [], stuff: []
    },
    {
      car: { plate: 'A888AA01', make: 'Hyundai', model: 'Solaris', color: 'Серый',
        owner_name: 'Никитин Павел Игоревич', owner_phone: '+7 909 111-22-33' },
      master: 'kuznetsov', status: 'in_work',
      works: [['Покраска крыши', 1]],
      paints: [['Краска Brulex MIX 168', 250]],
      stuff: []
    }
  ];

  for (const order of orders) {
    const created = await admin.post('/api/orders', {
      car: order.car,
      master_id: ids[order.master] || null,
      bodyworker_id: order.bodyworker ? ids[order.bodyworker] : null,
      comment: 'Демонстрационный заказ'
    });

    const orderId = created.order.id;

    for (const [name, qty] of order.works) {
      const work = pickWork(name);
      if (!work) continue;

      await admin.post(`/api/orders/${orderId}/works`, {
        work_id: work.id,
        qty: qty || work.parts || 1
      });
    }

    for (const [namePart, qty] of order.paints) {
      const material = await pickMaterial(namePart);
      if (!material) continue;

      await admin.post(`/api/orders/${orderId}/materials`, {
        kind: 'paint',
        code: material.code,
        name: material.name,
        unit: 'г',
        qty
      });
    }

    for (const [namePart, qty] of order.stuff) {
      const material = await pickMaterial(namePart);
      if (!material) continue;

      await admin.post(`/api/orders/${orderId}/materials`, {
        kind: 'material',
        code: material.code,
        name: material.name,
        unit: 'шт',
        qty
      });
    }

    if (order.status !== 'accepted') {
      await admin.patch(`/api/orders/${orderId}`, { status: order.status });
    }

    if (order.chat) {
      const author = await new Session().login(order.master, DEMO_PASS);
      await author.post('/api/chat', { channel: `order:${orderId}`, body: order.chat }).catch(() => {});
    }

    if (order.photo) {
      const file = path.join(photosDir, order.photo);

      if (fs.existsSync(file)) {
        const base64 = fs.readFileSync(file).toString('base64');
        await admin.post('/api/photos', {
          image: `data:image/jpeg;base64,${base64}`,
          orderId
        }).catch((error) => console.log('  фото:', error.message));
      }
    }

    console.log(`  заказ ${created.order.number} — ${order.car.plate} (${order.status})`);
    await sleep(150);
  }

  console.log('\n=== общий чат ===');
  const general = [
    ['manager1', 'Коллеги, завтра привозят краску, склад прошу принять.'],
    ['ivanov', 'Принял, капот доделаю к обеду.'],
    ['sergeev', 'На Mercedes дверь сдал, можно отдавать клиенту.']
  ];

  for (const [login, text] of general) {
    const session = await new Session().login(login, DEMO_PASS);
    await session.post('/api/chat', { channel: 'general', body: text }).catch((e) => console.log('  ', e.message));
    await sleep(120);
  }

  console.log('\nГотово.');
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
