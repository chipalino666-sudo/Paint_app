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
7. Если материала нет в базе — так и скажи и предложи уточнить код.`;

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
      description: 'Найти материал по коду или названию. Возвращает код, название, единицу и остаток.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'код (110, SE305283) или часть названия' } },
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
      name: 'propose_write_off',
      description: 'Подготовить списание материалов на заказ. Ничего не меняет — возвращает карточку для подтверждения человеком.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'integer', description: 'id заказа' },
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

      const needle = normalize(q);

      const orders = rows
        .filter((row) => normalize(row.number, row.plate, row.make, row.model, row.master).includes(needle))
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

    get_order({ order_id }) {
      const order = visibleOrder(Number(order_id));
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

    search_materials({ query }) {
      const q = String(query || '').trim();
      if (!q) return { materials: [] };

      const needle = normalize(q);
      const like = `%${needle}%`;

      const rows = db.prepare(`
        SELECT code, name, unit, category, price, stock,
               COALESCE((SELECT SUM(om.qty) FROM order_materials om WHERE om.code = materials.code), 0) AS used
          FROM materials
         WHERE active = 1 AND (search LIKE ? OR lower(code) LIKE ?)
         ORDER BY name
         LIMIT 8
      `).all(like, like);

      const materials = rows.map((row) => ({
        code: row.code,
        name: row.name,
        unit: row.unit,
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

    propose_write_off({ order_id, items }) {
      const order = visibleOrder(Number(order_id));
      if (!order) return { error: 'Заказ не найден или недоступен' };

      const list = [];
      const questions = [];

      for (const item of Array.isArray(items) ? items : []) {
        const code = String(item.code || '').trim().toUpperCase();
        if (!code) continue;

        const material = db.prepare('SELECT * FROM materials WHERE upper(code) = ? OR code = ?').get(code, item.code);
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
  let usage = { prompt_tokens: 0, completion_tokens: 0 };

  for (let round = 0; round < 4; round++) {
    const data = await ai.chat(messages, TOOLS);
    const choice = data.choices[0].message;

    usage.prompt_tokens += (data.usage && data.usage.prompt_tokens) || 0;
    usage.completion_tokens += (data.usage && data.usage.completion_tokens) || 0;

    messages.push(choice);

    if (!choice.tool_calls || !choice.tool_calls.length) {
      return { reply: String(choice.content || '').trim(), proposal, usage };
    }

    for (const call of choice.tool_calls) {
      let result;

      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const fn = tools[call.function.name];

        result = fn ? fn(args) : { error: `Неизвестный инструмент ${call.function.name}` };

        if (call.function.name === 'propose_write_off' && result && result.proposal) {
          proposal = result.proposal;
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

  return { reply: 'Не смог разобрать запрос. Уточните, пожалуйста: какой заказ и какой материал?', proposal, usage };
}

module.exports = { handle, SYSTEM };
