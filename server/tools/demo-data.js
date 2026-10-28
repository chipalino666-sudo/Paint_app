'use strict';

/*
 * Демонстрационные данные: мастера, приёмщик, несколько заказов в разных
 * статусах. Нужны, чтобы приложение не выглядело пустым при первом показе.
 *
 *   node tools/demo-data.js
 *
 * Запускать на пустой базе (до этого удалить server/data/paint.db*).
 */

const BASE = process.env.PAINT_URL || 'http://127.0.0.1:3000';
const ADMIN = { login: process.env.PAINT_LOGIN || 'admin', password: process.env.PAINT_ADMIN_PASSWORD || 'admin12345' };

let cookie = '';

async function call(method, path, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (error) { data = { raw: text }; }

  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function main() {
  const login = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN)
  });

  if (!login.ok) throw new Error('Не удалось войти администратором');

  const raw = login.headers.getSetCookie ? login.headers.getSetCookie().join(';') : login.headers.get('set-cookie');
  cookie = /psid=[^;]+/.exec(raw)[0];

  /* ---- люди ---- */

  const people = [
    { login: 'manager1', password: 'manager12345', full_name: 'Сидорова Анна Викторовна', role: 'manager' },
    { login: 'master', password: 'master12345', full_name: 'Рабочее место маляров', role: 'workstation' },
    { login: 'ivanov', password: 'master12345', full_name: 'Иванов Пётр Сергеевич', role: 'master', pin: '1111' },
    { login: 'sergeev', password: 'master12345', full_name: 'Сергеев Алексей Николаевич', role: 'master', pin: '2222' },
    { login: 'kuznetsov', password: 'master12345', full_name: 'Кузнецов Дмитрий Олегович', role: 'master', pin: '3333' }
  ];

  const ids = {};

  for (const person of people) {
    try {
      const created = await call('POST', '/api/users', person);
      ids[person.login] = created.id;
      console.log('  сотрудник:', person.full_name);
    } catch (error) {
      if (error.status === 400) console.log('  уже есть:', person.login);
      else throw error;
    }
  }

  /* ---- цены на работы ---- */

  const works = (await call('GET', '/api/works')).works;
  const priceByName = {
    'Покраска бампера': 6500,
    'Покраска крыла переднего': 7000,
    'Покраска крыла заднего': 7000,
    'Покраска двери': 8000,
    'Покраска капота': 12000,
    'Полировка детали': 3500
  };

  for (const work of works) {
    const price = priceByName[work.name];
    if (price) await call('PATCH', '/api/works/' + work.id, { price });
  }
  console.log('  цены на работы проставлены');

  /* ---- цены на материалы ---- */

  const materialPrices = {
    SE171695: { price: 4200, unit: 'л' },
    SE171704: { price: 3900, unit: 'л' },
    SE316461: { price: 250, unit: 'шт' }
  };

  for (const [code, data] of Object.entries(materialPrices)) {
    try { await call('PATCH', '/api/materials/' + encodeURIComponent(code), data); } catch (error) { /* нет такого кода */ }
  }
  console.log('  цены на материалы проставлены');

  /* ---- заказы ---- */

  const findWork = (name) => {
    const work = works.find((item) => item.name === name);
    return work ? work.id : works[0].id;
  };

  const orders = [
    {
      car: { plate: 'К777РТ 77', make: 'Kia', model: 'Rio', color: 'Белый', color_code: '221', owner_name: 'Петров И. И.', owner_phone: '+7 900 123-45-67' },
      master: 'ivanov', status: 'in_work', comment: 'Покраска бампера, царапина справа',
      works: [{ name: 'Покраска бампера', qty: 1 }],
      materials: [
        { code: 'SE171695', name: '563 Schwarz B 3.5 ltr', unit: 'г', kind: 'paint', qty: 180 }
      ]
    },
    {
      car: { plate: 'М456НВ 50', make: 'Lada', model: 'Vesta', color: 'Синий' },
      master: 'sergeev', status: 'accepted', comment: 'Крыло переднее и бампер',
      works: [{ name: 'Покраска крыла переднего', qty: 1 }, { name: 'Покраска бампера', qty: 1 }],
      materials: []
    },
    {
      car: { plate: 'О123АВ 99', make: 'Toyota', model: 'Camry', color: 'Чёрный', owner_phone: '+7 916 777-00-11' },
      master: 'kuznetsov', status: 'ready', comment: 'Полировка после покраски',
      works: [{ name: 'Полировка детали', qty: 2 }],
      materials: [{ code: 'SE316461', name: '190 мкм APPS A1 Стакан с крышкой', unit: 'шт', kind: 'material', qty: 2 }]
    },
    {
      car: { plate: 'Т890ЕС 71', make: 'Skoda', model: 'Octavia', color: 'Серый' },
      master: 'ivanov', status: 'closed', comment: 'Покраска двери, закрыт',
      works: [{ name: 'Покраска двери', qty: 1 }],
      materials: [{ code: 'SE171704', name: '575 Brillantgelb B 1 ltr', unit: 'г', kind: 'paint', qty: 120 }]
    }
  ];

  for (const item of orders) {
    const created = await call('POST', '/api/orders', {
      car: item.car,
      master_id: ids[item.master] || null,
      comment: item.comment,
      works: item.works.map((row) => ({ work_id: findWork(row.name), qty: row.qty }))
    });

    const orderId = created.order.id;

    for (const material of item.materials) {
      await call('POST', `/api/orders/${orderId}/materials`, material);
    }

    // Доводим до нужного статуса
    if (item.status === 'in_work') await call('PATCH', `/api/orders/${orderId}`, { status: 'in_work' });
    if (item.status === 'ready') await call('PATCH', `/api/orders/${orderId}`, { status: 'ready' });
    if (item.status === 'closed') {
      await call('PATCH', `/api/orders/${orderId}`, { status: 'in_work' });
      await call('PATCH', `/api/orders/${orderId}`, { status: 'ready' });
      await call('PATCH', `/api/orders/${orderId}`, { status: 'closed' });
    }

    console.log(`  заказ ${created.order.number}: ${item.car.plate} — ${item.status}`);
  }

  console.log('\nГотово.');
  console.log('  Компьютер мастеров: вход master / master12345, затем ПИН 1111, 2222 или 3333');
  console.log('  Приёмщик: manager1 / manager12345');
  console.log('  Администратор: admin / admin12345');
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
