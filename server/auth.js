'use strict';

/* ==========================================================================
   Сессии, куки и ПИН-коды рабочего места.
   Пароли и ПИНы — scrypt, сессии — в таблице sessions.
   ========================================================================== */

const { db, nowISO, randomToken } = require('./db');

const COOKIE_NAME = 'psid';
const SESSION_DAYS = 14;

function createSession(userId) {
  const token = randomToken(32);
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen)
              VALUES (?, ?, ?, ?, ?)`)
    .run(token, userId, created.toISOString(), expires.toISOString(), created.toISOString());

  return { token, expires };
}

/**
 * Сессия вместе с аккаунтом, под которым выполнен вход.
 * У рабочего места мастеров account — это «общая» учётка, а activeUserId — тот,
 * чей кабинет сейчас открыт по ПИНу (может быть не задан, если никто не вошёл).
 */
function loadSession(token) {
  if (!token) return null;

  const row = db.prepare(`
    SELECT s.token        AS session_token,
           s.active_user_id,
           s.last_seen,
           s.expires_at,
           u.id, u.login, u.full_name, u.role, u.active, u.is_workstation
      FROM sessions s
      JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?
  `).get(token, nowISO());

  if (!row) return null;

  const { session_token, active_user_id, last_seen, expires_at, ...account } = row;

  return {
    token: session_token,
    activeUserId: active_user_id || null,
    lastSeen: last_seen,
    expiresAt: expires_at,
    account
  };
}

/** Отметка активности — по ней считается бездействие. */
function touchSession(token, activeUserId) {
  if (activeUserId === undefined) {
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(nowISO(), token);
  } else {
    db.prepare('UPDATE sessions SET last_seen = ?, active_user_id = ? WHERE token = ?')
      .run(nowISO(), activeUserId, token);
  }
}

function lockSession(token) {
  db.prepare('UPDATE sessions SET active_user_id = NULL, last_seen = ? WHERE token = ?')
    .run(nowISO(), token);
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowISO());
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

function setSessionCookie(res, token, expires, secure = false) {
  const maxAge = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  const flags = `HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; ${flags}`);
}

function clearSessionCookie(res, secure = false) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
}

module.exports = {
  COOKIE_NAME,
  createSession,
  loadSession,
  touchSession,
  lockSession,
  destroySession,
  cleanupSessions,
  parseCookies,
  setSessionCookie,
  clearSessionCookie
};
