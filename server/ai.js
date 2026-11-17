'use strict';

/* ==========================================================================
   ИИ-помощник: связь с DeepSeek через их API.

   Ключ берётся из переменной окружения DEEPSEEK_API_KEY — он лежит только
   на сервере, в браузер не попадает никогда.
   ========================================================================== */

const BASE = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat');
const KEY = String(process.env.DEEPSEEK_API_KEY || '');
const TIMEOUT = Number(process.env.DEEPSEEK_TIMEOUT || 45000);

function configured() {
  return KEY.length > 20;
}

/** Один запрос к модели. messages и tools — в формате OpenAI. */
async function chat(messages, tools) {
  if (!configured()) {
    throw new Error('Ключ DeepSeek не настроен на сервере');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
        temperature: 0.2
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      const detail = data && data.error && data.error.message
        ? data.error.message
        : `HTTP ${response.status}`;
      throw new Error(detail);
    }

    if (!data || !data.choices || !data.choices.length) {
      throw new Error('Пустой ответ модели');
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Проверка ключа: какие модели доступны. */
async function models() {
  if (!configured()) throw new Error('Ключ DeepSeek не настроен на сервере');

  const response = await fetch(`${BASE}/models`, {
    headers: { Authorization: `Bearer ${KEY}` }
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }

  if (!response.ok) {
    throw new Error((data && data.error && data.error.message) || `HTTP ${response.status}`);
  }

  return data;
}

module.exports = { configured, chat, models, MODEL, BASE };
