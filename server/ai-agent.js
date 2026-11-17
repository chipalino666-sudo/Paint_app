'use strict';

/* ==========================================================================
   ИИ-помощник цеха: инструменты по базе и сборка ответа.

   Модель только понимает просьбу и выбирает действие. Все числа — из базы:
   остатки, нормы расхода, цены. Запись в базу делает человек кнопкой.
   ========================================================================== */

const ai = require('./ai');

const SYSTEM = `Ты — ИИ-помощник малярного цеха «Лонжерон». Помогаешь малярам, приёмщикам и кладовщику.

Правила:
1. Никогда не выдумывай названия, коды, количество и остатки. Всё берётся инструментами.
2. Если непонятно, какой заказ или материал — задай один короткий вопрос, не угадывай.
3. Для списания вызывай propose_write_off. Запись в базу делает человек кнопкой «Списать» — сам не списывай.
4. Количество указывай только если человек его назвал или оно есть в нормах. Если нет — спроси.
5. Отвечай по-русски, коротко, обычным текстом без таблиц и markdown.
6. Ты не видишь чужие заказы: только те, что доступны этому сотруднику.
7. Если материала нет в базе — так и скажи и предложи уточнить код.
8. Если поиск по коду дал ровно один подходящий материал — сразу используй его, не переспрашивай. Переспрашивай, только когда подходящих несколько и они разные.
9. Формулу краски понимай буквально: «110 — 800 грамм, лак 442 — 200» — это коды и граммы. Сразу вызывай propose_recipe, не спрашивай подтверждения.
10. Когда просят списать «по нормам» или называют только краску и количество деталей — вызывай apply_norms: он сам подставит лак, отвердитель, разбавитель и расходники на машину.
11. У красок два взаимозаменяемых кода: Brulex и Standox (570 = 110B, 562 = 101, 563 = 103 и так далее). Если назвали любой из них — это один и тот же цвет, не переспрашивай и не говори «это не Standox». Просто скажи: «570 — это Brulex MIX 110B».
12. Цифры остатков бери только из инструментов. Если материал в граммах, так и говори — «66 840 г», а не «66,84 шт».
17. Если просят списать готовую краску («Lada 221», «Серебро 570») — это рецепт, а не материал: вызывай apply_norms с полем recipe. Не ищи её по коду среди материалов.
18. Заказ можно указывать словами («Skoda Rapid», госномер, номер) — передавай это в поле order, а не выдумывай id. Если заказ уже называли в диалоге, подставь его сам, не переспрашивай.
19. Если инструмент вернул несколько подходящих заказов (ambiguity), покажи их списком — номер, госномер, статус — и спроси, какой именно. Никогда не выбирай за человека.
21. Понимаешь и русский, и латиницу: «Skoda Rapid» = «Шкода Рапид», «Lada» = «Лада», «Fetisov» = «Фетисов». Если инструмент не нашёл по одному написанию — попробуй другое, не сдавайся сразу.
20. Если просят открыть заказ или раздел («открой списание по Шкоде», «покажи склад») — вызывай open_in_app. После вызова коротко подтверди: «Открываю заказ 2026-0025, вкладка «Списание материала»».
15. Название и код материала бери ТОЛЬКО из ответа инструмента в этом же сообщении. Если инструмент такой код не вернул — так и скажи: «такого материала нет». Не подставляй похожие буквы и цифры: в базе «Brulex MIX 112», а не «113В».
16. Перед тем как назвать краску по коду — вызывай lookup_code. Если сомневаешься в предыдущем ответе, перепроверь инструментом, а не памятью диалога.
14. На вопросы «сколько машин в работе», «что готово», «что принято» вызывай list_orders и отвечай числом и коротким списком. Не говори «не нашёл», если человек спрашивает про количество.
13. Готовая краска (рецепт) собирается ТОЛЬКО из красок — колер-паст и баз. Лак, отвердитель, разбавитель в рецепт не входят: если их назвали, скажи, что это не краска, и предложи краску по коду.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_orders',
      description: 'Найти заказы по номеру, госномеру машины, марке или фамилии мастера.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'номер заказа, госномер или фамилия мастера' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_order',
      description: 'Показать состав заказа: работы, материалы, суммы, статус.',
      parameters: {
        type: 'object',
        properties: { order_id: { type: 'integer', description: 'номер (id) заказа' } },
        required: ['order_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_materials',
      description: 'Найти материал по коду или названию. Возвращает код, название, единицу и остаток. При сборке готовой краски передавай only_paints: true.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'код (110, SE305283) или часть названия' },
          only_paints: { type: 'boolean', description: 'искать только среди красок (для рецептов)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_tds',
      description: 'Ссылки на техническую документацию (ТДС) по материалу.',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: 'код материала' } },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_in_app',
      description: 'Открыть в программе заказ, его вкладку или раздел. Используй, когда просят «открой заказ», «покажи списание», «открой склад».',
      parameters: {
        type: 'object',
        properties: {
          order: { type: 'string', description: 'номер, госномер или марка машины' },
          tab: {
            type: 'string',
            enum: ['order', 'inspection', 'materials', 'photos', 'history', 'chat'],
            description: 'вкладка внутри заказа: order — карточка, inspection — осмотр, materials — списание, photos — фото, history — история, chat — обсуждение'
          },
          view: {
            type: 'string',
            enum: ['orders', 'chat', 'stock', 'tds', 'norms', 'refs', 'report'],
            description: 'раздел программы, если открыть надо не заказ'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'lookup_code',
      description: 'Точная сверка кода: возвращает материалы с таким кодом, кодом цвета или парой Brulex/Standox. Вызывай ПЕРЕД тем, как назвать материал по коду.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'код: 573, SE313820, 110B' },
          only_paints: { type: 'boolean', description: 'только краски' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_orders',
      description: 'Показать заказы по статусу и посчитать их: «сколько в работе», «что готово», «что принято». Без status — все открытые.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['accepted', 'in_work', 'ready', 'closed', 'open', 'all'],
            description: 'accepted — приняты, in_work — в работе, ready — готовы, closed — закрыты, open — все кроме закрытых, all — все'
          },
          limit: { type: 'integer', description: 'сколько заказов вернуть в списке, по умолчанию 10' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_norms',
      description: 'Подготовить списание по нормам цеха: на N деталей и на машину. Для готовой краски передавай её название в recipe — состав возьмётся из рецепта и пересчитается на нужное количество.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'integer', description: 'id заказа, если он известен' },
          order: { type: 'string', description: 'номер заказа, госномер или марка машины: 2026-0025, P654HP30, Skoda Rapid' },
          paint_code: { type: 'string', description: 'код краски (цвета), которую красят' },
          recipe: { type: 'string', description: 'название готовой краски, если красят ею (Lada 221)' },
          parts: { type: 'number', description: 'количество деталей; по умолчанию 1' }
        },
        required: ['order_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_recipe',
      description: 'Подготовить новую готовую краску (рецепт) из названия и состава. В состав берутся ТОЛЬКО краски (колер-пасты), лаки и отвердители не подходят. Ничего не сохраняет — человек подтвердит кнопкой.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'название цвета, например «Серебро 570»' },
          base: { type: 'number', description: 'сколько готовить, в граммах; по умолчанию 1000' },
          mixes: {
            type: 'array',
            description: 'состав',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'код материала' },
                qty: { type: 'number', description: 'граммы этого микса' }
              },
              required: ['code', 'qty']
            }
          }
        },
        required: ['name', 'mixes']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_write_off',
      description: 'Подготовить списание материалов на заказ. Ничего не меняет — возвращает карточку для подтверждения человеком.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'integer', description: 'id заказа, если он известен' },
          order: { type: 'string', description: 'номер заказа, госномер или марка машины: 2026-0025, P654HP30, Skoda Rapid' },
          items: {
            type: 'array',
            description: 'что списать',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'код материала' },
                qty: { type: 'number', description: 'количество; если человек не назвал — не указывай' },
                kind: { type: 'string', enum: ['paint', 'material'], description: 'краска или материал' }
              },
              required: ['code']
            }
          }
        },
        required: ['order_id', 'items']
      }
    }
  }
];

/** SQLite не понимает регистр в кириллице — нормализуем на стороне JS. */
function normalize(...parts) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join(' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---- Транслитерация: «Шкода» = «Skoda», «Лада» = «Lada» ------------------ */

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

/** Кириллица → латиница, только буквы и цифры. */
function translit(text) {
  return String(text || '')
    .toLowerCase()
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

/** Грубый «звуковой» ключ: sh→s, kh→h, x→ks — чтобы Шкода сошлась со Skoda. */
function phonetic(text) {
  return translit(text)
    .replace(/sch/g, 's')
    .replace(/sh/g, 's')
    .replace(/ch/g, 'c')
    .replace(/zh/g, 'z')
    .replace(/kh/g, 'h')
    .replace(/j/g, 'i')
    .replace(/x/g, 'ks')
    .replace(/ya/g, 'a')
    .replace(/yu/g, 'u')
    .replace(/yo/g, 'e')
    .replace(/(.)\1+/g, '$1');
}

function makeNeedle(text) {
  return { plain: normalize(text), sound: phonetic(text) };
}

/** Совпадает ли значение с запросом — по обычному ключу или по звуковому. */
function matchesText(value, needle) {
  const plain = normalize(value);
  const sound = phonetic(value);

  return plain.includes(needle.plain)
    || (needle.sound.length > 1 && sound.includes(needle.sound));
}

/** Находит материал по коду, коду краски (110) или названию. */
function resolveMaterial(db, query, options = {}) {
  const paintOnly = Boolean(options.paintOnly);
  const raw = String(query || '').trim();
  if (!raw) return null;

  const exact = db.prepare('SELECT * FROM materials WHERE upper(code) = ?').get(raw.toUpperCase());

  if (exact) {
    if (paintOnly && exact.category !== 'paint') return null;
    return exact;
  }

  const needle = normalize(raw);

  const { code: digits, pairs } = crossCodes(db, raw);
  const codeList = digits ? [digits, ...pairs].filter(Boolean) : [];

  const categoryFilter = paintOnly ? " AND category = 'paint'" : '';

  let rows = codeList.length
    ? db.prepare('SELECT * FROM materials WHERE active = 1' + categoryFilter
        + ' AND (paint_code IN (' + codeList.map(() => '?').join(',') + ') OR search LIKE ?) LIMIT 30')
        .all(...codeList, '%' + needle + '%')
    : db.prepare('SELECT * FROM materials WHERE active = 1' + categoryFilter + ' AND search LIKE ? LIMIT 30')
        .all('%' + needle + '%');

  if (!rows.length && /^\d{2,4}$/.test(needle)) {
    rows = db.prepare('SELECT * FROM materials WHERE active = 1' + categoryFilter + ' AND paint_code LIKE ? LIMIT 30')
      .all(needle + '%');
  }

  if (!rows.length) return null;

  rows.sort((a, b) => {
    const paint = (a.category === 'paint' ? 0 : 1) - (b.category === 'paint' ? 0 : 1);
    return paint || String(a.name).length - String(b.name).length;
  });

  return rows[0];
}

/** Пары кодов Brulex ↔ Standox: 110 ↔ 570 и т.п. */
function crossCodes(db, text) {
  const digits = String(text || '').match(/\d{2,4}/);
  if (!digits) return { code: null, pairs: [] };

  const code = digits[0];
  const rows = db.prepare('SELECT code_a, code_b FROM code_pairs WHERE code_a = ? OR code_b = ?').all(code, code);

  const pairs = [];
  for (const row of rows) {
    if (row.code_a !== code) pairs.push(row.code_a);
    if (row.code_b !== code) pairs.push(row.code_b);
  }

  return { code, pairs: [...new Set(pairs)] };
}

function normQty(db, orderId, code) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(n.qty * ow.qty), 0) AS q
      FROM order_works ow
      JOIN norms n ON n.work_id = ow.work_id
     WHERE ow.order_id = ? AND n.code = ?
  `).get(orderId, code);

  return Number(row && row.q) || 0;
}

function makeContext(env) {
  const { db, user, canSeeOrder, round2 } = env;

  const visibleOrder = (id) => {
    const order = env.orderView(id);
    if (!order || !canSeeOrder(user, order)) return null;
    return order;
  };

  /**
   * Заказ по номеру, госномеру, марке или мастеру.
   * Возвращает { order } или { ambiguous: [...] } — если подходит несколько.
   */
  const findOrder = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return { order: null };

    const rows = db.prepare(`
      SELECT o.id, o.number, o.status, c.plate, c.make, c.model, u.full_name AS master
        FROM orders o
        JOIN cars c ON c.id = o.car_id
        LEFT JOIN users u ON u.id = o.master_id
       ORDER BY o.id DESC
       LIMIT 500
    `).all();

    const visible = rows.filter((row) => visibleOrder(row.id));
    const needle = makeNeedle(text);

    // Точные совпадения: номер заказа или госномер — они уникальны
    const exact = visible.filter((row) =>
      matchesText(row.number, needle) && normalize(row.number) === needle.plain
      || normalize(row.plate) === needle.plain);
    if (exact.length === 1) return { order: visibleOrder(exact[0].id) };

    const partial = visible.filter((row) =>
      matchesText(row.number, needle)
      || matchesText(row.plate, needle)
      || matchesText([row.make, row.model].join(' '), needle)
      || matchesText(row.master, needle)
      || matchesText(row.number + ' ' + row.plate + ' ' + row.make + ' ' + row.model + ' ' + (row.master || ''), needle));

    // Машины с одинаковым названием: не угадываем, показываем варианты
    if (partial.length > 1) {
      const open = partial.filter((row) => row.status !== 'closed');
      const list = open.length ? open : partial;

      if (list.length > 1) {
        return {
          order: null,
          ambiguous: list.slice(0, 8).map((row) => ({
            number: row.number,
            plate: row.plate,
            car: [row.make, row.model].filter(Boolean).join(' '),
            master: row.master,
            status: row.status
          }))
        };
      }

      return { order: visibleOrder(list[0].id) };
    }

    return { order: partial.length ? visibleOrder(partial[0].id) : null };
  };

  /** Разбор ссылки на заказ: «2026-0025», «Skoda Rapid», «P654HP30» или id. */
  const orderRef = (args) => {
    for (const value of [args.order, args.order_id]) {
      const text = String(value ?? '').trim();
      if (!text) continue;

      const asNumber = Number(text);
      if (Number.isFinite(asNumber) && String(asNumber) === text) {
        const byId = visibleOrder(asNumber);
        if (byId) return { order: byId };
      }

      const found = findOrder(text);
      if (found.order || found.ambiguous) return found;
    }

    return { order: null };
  };

  /** Единый ответ на неоднозначный заказ. */
  const ambiguityAnswer = (found) => ({
    error: 'Под этот запрос подходит несколько заказов — уточните, какой именно',
    orders: found.ambiguous
  });

  return {
    search_orders({ query }) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return { orders: [] };

      const rows = db.prepare(`
        SELECT o.id, o.number, o.status, c.plate, c.make, c.model, u.full_name AS master
          FROM orders o
          JOIN cars c ON c.id = o.car_id
          LEFT JOIN users u ON u.id = o.master_id
         ORDER BY o.id DESC
         LIMIT 300
      `).all();

      const needle = makeNeedle(q);

      const orders = rows
        .filter((row) => matchesText(
          [row.number, row.plate, row.make, row.model, row.master].filter(Boolean).join(' '), needle))
        .filter((row) => visibleOrder(row.id))
        .slice(0, 8)
        .map((row) => ({
          id: row.id,
          number: row.number,
          plate: row.plate,
          car: [row.make, row.model].filter(Boolean).join(' '),
          master: row.master,
          status: row.status
        }));

      return { orders };
    },

    get_order({ order_id, order: orderText }) {
      const found = orderRef({ order_id, order: orderText });
      if (found.ambiguous) return ambiguityAnswer(found);

      const order = found.order;
      if (!order) return { error: 'Заказ не найден или недоступен' };

      return {
        id: order.id,
        number: order.number,
        plate: order.plate,
        car: [order.make, order.model].filter(Boolean).join(' '),
        status: order.status,
        master: order.master_name || null,
        total: order.total,
        works: (order.works || []).map((w) => ({ name: w.name, qty: w.qty, sum: w.sum })),
        materials: (order.materials || []).map((m) => ({
          code: m.code, name: m.name, qty: m.qty, unit: m.unit, kind: m.kind
        }))
      };
    },

    search_materials({ query, only_paints }) {
      const q = String(query || '').trim();
      if (!q) return { materials: [] };

      const needle = normalize(q);
      const like = `%${needle}%`;

      const { code: digits, pairs } = crossCodes(db, q);
      const codeList = digits ? [digits, ...pairs].filter(Boolean) : [];
      const onlyPaints = Boolean(only_paints);
      const paintFilter = onlyPaints ? " AND category = 'paint'" : '';

      const rows = codeList.length
        ? db.prepare(`
            SELECT code, name, unit, category, price, stock, paint_code,
                   COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = materials.code), 0) AS used
              FROM materials
             WHERE active = 1${paintFilter} AND (search LIKE ? OR paint_code IN (${codeList.map(() => '?').join(',')}))
             ORDER BY CASE WHEN category = 'paint' THEN 0 ELSE 1 END, name
             LIMIT 8
          `).all(like, ...codeList)
        : db.prepare(`
            SELECT code, name, unit, category, price, stock, paint_code,
                   COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = materials.code), 0) AS used
              FROM materials
             WHERE active = 1${paintFilter} AND (search LIKE ? OR lower(code) LIKE ?)
             ORDER BY name
             LIMIT 8
          `).all(like, like);

      // Ничего не нашли запросом — пробуем по транслиту («lada» ↔ «Лада», «skoda» ↔ «Шкода»)
      let finalRows = rows;

      if (!finalRows.length) {
        const needle = makeNeedle(q);

        finalRows = db.prepare(`
          SELECT code, name, unit, category, price, stock, paint_code,
                 COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = materials.code), 0) AS used
            FROM materials
           WHERE active = 1${paintFilter}
        `).all()
          .filter((row) => matchesText(row.name, needle) || matchesText(row.code, needle) || matchesText(row.paint_code || '', needle))
          .slice(0, 8);
      }

      const materials = finalRows.map((row) => ({
        code: row.code,
        name: row.name,
        unit: row.unit,
        paint_code: row.paint_code || null,
        left: round2((Number(row.stock) || 0) - (Number(row.used) || 0))
      }));

      return { materials };
    },

    get_tds({ code }) {
      const docs = db.prepare('SELECT title, url FROM material_docs WHERE code = ?').all(String(code || ''));

      if (!docs.length) {
        return { found: false, message: 'На этот материал ТДС не заведён' };
      }

      return { found: true, docs };
    },

    open_in_app({ order, tab, view }) {
      const allowedViews = ['orders', 'chat', 'stock', 'tds', 'norms', 'refs', 'report'];
      const allowedTabs = ['order', 'inspection', 'materials', 'photos', 'history', 'chat'];

      // Открыть раздел программы
      if (view && allowedViews.includes(view)) {
        return {
          opened: { type: 'view', view },
          message: `Открываю раздел «${view}»`
        };
      }

      if (!order) return { error: 'Не указано, что открыть' };

      const found = orderRef({ order });
      if (found.ambiguous) return ambiguityAnswer(found);

      const target = found.order;
      if (!target) return { error: 'Заказ не найден или недоступен' };

      const tabName = allowedTabs.includes(tab) ? tab : 'order';

      return {
        opened: { type: 'order', order_id: target.id, tab: tabName },
        order: {
          number: target.number,
          plate: target.plate,
          car: [target.make, target.model].filter(Boolean).join(' '),
          status: target.status
        },
        message: `Открываю заказ ${target.number}`
      };
    },

    lookup_code({ code, only_paints }) {
      const raw = String(code || '').trim();
      if (!raw) return { found: false, materials: [] };

      const paintOnly = Boolean(only_paints);
      const filter = paintOnly ? " AND category = 'paint'" : '';

      const { code: digits, pairs } = crossCodes(db, raw);
      const codeList = digits ? [digits, ...pairs].filter(Boolean) : [];

      const rows = db.prepare(`
        SELECT code, name, paint_code, aliases, unit, category, stock
          FROM materials
         WHERE active = 1${filter}
           AND (upper(code) = ? OR paint_code IN (${(codeList.length ? codeList : ['\u0000']).map(() => '?').join(',')})
                OR search LIKE ?)
         ORDER BY CASE WHEN category = 'paint' THEN 0 ELSE 1 END, name
         LIMIT 10
      `).all(raw.toUpperCase(), ...(codeList.length ? codeList : ['\u0000']), '%' + normalize(raw) + '%');

      return {
        found: rows.length > 0,
        codes: { asked: digits || null, pairs },
        materials: rows.map((row) => ({
          code: row.code,
          name: row.name,
          paint_code: row.paint_code || null,
          aliases: row.aliases || null,
          unit: row.unit,
          category: row.category,
          stock: row.stock
        }))
      };
    },

    list_orders({ status, limit }) {
      const rows = db.prepare(`
        SELECT o.id, o.number, o.status, c.plate, c.make, c.model, u.full_name AS master
          FROM orders o
          JOIN cars c ON c.id = o.car_id
          LEFT JOIN users u ON u.id = o.master_id
         ORDER BY o.id DESC
      `).all();

      const visible = rows.filter((row) => visibleOrder(row.id));

      const counts = { accepted: 0, in_work: 0, ready: 0, closed: 0 };
      for (const row of visible) counts[row.status] = (counts[row.status] || 0) + 1;

      const scope = ['accepted', 'in_work', 'ready', 'closed', 'open', 'all'].includes(status) ? status : 'open';

      const filtered = visible.filter((row) => {
        if (scope === 'all') return true;
        if (scope === 'open') return row.status !== 'closed';
        return row.status === scope;
      });

      const take = Math.min(Math.max(Number(limit) || 10, 1), 30);

      return {
        counts,
        scope,
        count: filtered.length,
        total_sum: round2(filtered.reduce((sum, row) => {
          const full = env.orderView(row.id);
          return sum + (full ? Number(full.total) || 0 : 0);
        }, 0)),
        orders: filtered.slice(0, take).map((row) => ({
          number: row.number,
          plate: row.plate,
          car: [row.make, row.model].filter(Boolean).join(' '),
          status: row.status,
          master: row.master
        }))
      };
    },

    apply_norms({ order_id, order: orderText, paint_code, recipe, parts }) {
      const found = orderRef({ order_id, order: orderText });
      if (found.ambiguous) return ambiguityAnswer(found);

      const order = found.order;
      if (!order) return { error: 'Заказ не найден или недоступен' };

      const count = Number(parts) > 0 ? Number(parts) : 1;
      const paint = String(paint_code || '').trim();
      const recipeName = String(recipe || '').trim();

      const mine = db.prepare('SELECT * FROM norm_items WHERE owner_id = ? ORDER BY sort, id').all(Number(user.id));
      const common = db.prepare('SELECT * FROM norm_items WHERE owner_id IS NULL ORDER BY sort, id').all();
      const set = mine.length ? mine : common;

      // Готовая краска: берём её состав и пересчитываем на нужное количество краски
      let chosenRecipe = null;

      if (recipeName) {
        const all = db.prepare('SELECT * FROM recipes ORDER BY name').all().map((row) => {
          let mixes = [];
          try { mixes = JSON.parse(row.mixes) || []; } catch (error) { mixes = []; }
          return { id: row.id, name: row.name, base: Number(row.base) || 0, unit: row.unit, mixes };
        });

        const needle = makeNeedle(recipeName);

        chosenRecipe = all.find((r) => normalize(r.name) === needle.plain)
          || all.find((r) => matchesText(r.name, needle));

        if (!chosenRecipe) {
          return {
            error: `Готовая краска «${recipeName}» не найдена`,
            recipes: all.slice(0, 10).map((r) => r.name)
          };
        }
      }

      const items = [];
      const questions = [];

      const paintNorm = set.find((norm) => norm.role === 'paint');
      const paintQty = paintNorm ? round2(Number(paintNorm.qty) * count) : null;

      for (const norm of set) {
        const factor = norm.per === 'order' ? 1 : count;

        // Строку «краска» заменяет готовый рецепт
        if (norm.role === 'paint' && chosenRecipe) continue;

        let code = norm.code;
        let name = '';

        if (norm.role === 'paint') {
          if (!paint) {
            questions.push('Какую краску списываем? Назовите код или название готовой краски.');
            continue;
          }

          const material = resolveMaterial(db, paint);
          if (!material) {
            questions.push(`Краска «${paint}» не найдена — уточните код`);
            continue;
          }

          code = material.code;
          name = material.name;
        } else {
          const material = db.prepare('SELECT name FROM materials WHERE code = ?').get(norm.code);
          name = material ? material.name : norm.code;
        }

        const used = db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM order_materials WHERE code = ?').get(code).n;
        const material = db.prepare('SELECT stock, unit FROM materials WHERE code = ?').get(code);

        items.push({
          code,
          name,
          unit: norm.unit || (material && material.unit) || 'г',
          qty: round2(Number(norm.qty) * factor),
          kind: (norm.role === 'paint' || (material && material.unit === 'г')) ? 'paint' : 'material',
          left_after: material
            ? round2((Number(material.stock) || 0) - (Number(used) || 0) - round2(Number(norm.qty) * factor))
            : null
        });
      }

      // Добавляем микс-компоненты готовой краски, пересчитанные на количество краски
      if (chosenRecipe) {
        const need = paintQty || round2(chosenRecipe.base * count) || chosenRecipe.base;
        const k = chosenRecipe.base > 0 ? need / chosenRecipe.base : 1;

        for (const mix of chosenRecipe.mixes) {
          const material = resolveMaterial(db, mix.code || mix.name, { paintOnly: true });
          if (!material) {
            questions.push(`Микс «${mix.name}» из рецепта «${chosenRecipe.name}» не найден в базе`);
            continue;
          }

          const qty = round2(Number(mix.amount) * k);
          if (!(qty > 0)) continue;

          const used = db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM order_materials WHERE code = ?').get(material.code).n;

          items.unshift({
            code: material.code,
            name: material.name,
            unit: 'г',
            qty,
            kind: 'paint',
            left_after: round2((Number(material.stock) || 0) - (Number(used) || 0) - qty)
          });
        }
      }

      return {
        proposal: {
          order_id: order.id,
          number: order.number,
          plate: order.plate,
          parts: count,
          recipe: chosenRecipe ? chosenRecipe.name : null,
          items
        },
        questions
      };
    },

    propose_recipe({ name, base, mixes }) {
      const title = String(name || '').trim();
      if (!title) return { error: 'Не указано название цвета' };

      const list = [];
      const questions = [];

      for (const mix of Array.isArray(mixes) ? mixes : []) {
        const code = String(mix.code || '').trim().toUpperCase();
        if (!code) continue;

        // В готовую краску идут только краски: лаки и отвердители не подходят
        const material = resolveMaterial(db, mix.code, { paintOnly: true });
        if (!material) {
          questions.push(`«${mix.code}» — не краска или не найдена. В состав готовой краски идут только краски (колер-пасты), без лаков и отвердителей.`);
          continue;
        }

        const amount = Number(mix.qty) || 0;
        if (!amount) {
          questions.push(`Сколько грамм ${material.name}?`);
          continue;
        }

        list.push({ code: material.code, name: material.name, amount: round2(amount) });
      }

      if (list.length < 1) {
        return { error: 'В составе нет ни одного микса', questions };
      }

      const total = list.reduce((sum, item) => sum + item.amount, 0);

      return {
        proposal: {
          kind: 'recipe',
          name: title,
          base: round2(Number(base) || total || 1000),
          unit: 'г',
          mixes: list
        },
        questions
      };
    },

    propose_write_off({ order_id, order: orderText, items }) {
      const found = orderRef({ order_id, order: orderText });
      if (found.ambiguous) return ambiguityAnswer(found);

      const order = found.order;
      if (!order) return { error: 'Заказ не найден или недоступен' };

      const list = [];
      const questions = [];

      for (const item of Array.isArray(items) ? items : []) {
        const code = String(item.code || '').trim().toUpperCase();
        if (!code) continue;

        const material = resolveMaterial(db, item.code);
        if (!material) {
          questions.push(`Материал с кодом ${item.code} не найден — уточните код`);
          continue;
        }

        let qty = Number(item.qty) || 0;

        // Количество не названо — пробуем нормы расхода по работам заказа
        if (!qty) qty = normQty(db, order.id, material.code);

        if (!qty) {
          questions.push(`Сколько ${material.name} списать?`);
          continue;
        }

        const used = db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM order_materials WHERE code = ?').get(material.code).n;
        const left = round2((Number(material.stock) || 0) - (Number(used) || 0));

        list.push({
          code: material.code,
          name: material.name,
          unit: item.kind === 'paint' ? 'г' : (material.unit || 'г'),
          qty: round2(qty),
          kind: item.kind === 'paint' ? 'paint' : (material.category === 'paint' ? 'paint' : 'material'),
          left_before: left,
          left_after: round2(left - qty)
        });
      }

      return {
        proposal: {
          order_id: order.id,
          number: order.number,
          plate: order.plate,
          items: list
        },
        questions
      };
    }
  };
}

/** Один диалог: до 4 обращений к модели, пока она не ответит текстом. */
async function handle(env, { message, history, orderId }) {
  const db = env.db;
  const tools = makeContext(env);

  const contextLine = orderId
    ? `Сейчас сотрудник открыл заказ с id ${orderId}. Если он говорит «этот заказ» — это он.`
    : 'Заказ не открыт.';

  const messages = [
    { role: 'system', content: `${SYSTEM}\n\nТекущий сотрудник: ${env.user.full_name} (${env.user.role}). ${contextLine}` }
  ];

  for (const item of Array.isArray(history) ? history.slice(-8) : []) {
    if (!item || !item.role || !item.content) continue;
    if (item.role !== 'user' && item.role !== 'assistant') continue;
    messages.push({ role: item.role, content: String(item.content).slice(0, 2000) });
  }

  messages.push({ role: 'user', content: String(message || '').slice(0, 2000) });

  let proposal = null;
  let opened = null;
  let usage = { prompt_tokens: 0, completion_tokens: 0 };

  for (let round = 0; round < 4; round++) {
    const data = await ai.chat(messages, TOOLS);
    const choice = data.choices[0].message;

    usage.prompt_tokens += (data.usage && data.usage.prompt_tokens) || 0;
    usage.completion_tokens += (data.usage && data.usage.completion_tokens) || 0;

    messages.push(choice);

    if (!choice.tool_calls || !choice.tool_calls.length) {
      return { reply: String(choice.content || '').trim(), proposal, opened, usage };
    }

    for (const call of choice.tool_calls) {
      let result;

      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const fn = tools[call.function.name];

        result = fn ? fn(args) : { error: `Неизвестный инструмент ${call.function.name}` };

        if ((call.function.name === 'propose_write_off' || call.function.name === 'propose_recipe' || call.function.name === 'apply_norms')
            && result && result.proposal) {
          proposal = result.proposal;
        }

        if (call.function.name === 'open_in_app' && result && result.opened) {
          opened = result.opened;
        }
      } catch (error) {
        result = { error: error.message };
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }

  return { reply: 'Не смог разобрать запрос. Уточните, пожалуйста: какой заказ и какой материал?', proposal, opened, usage };
}

module.exports = { handle, SYSTEM };
