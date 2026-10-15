// ============================================================
// lib/store.js — database access layer (all db calls live here)
// Every function is async; integrity is enforced in code (no FKs).
// ============================================================
import { db } from 'sdk';
import { eq, and, or, desc, asc, gte, inArray, sql } from 'sdk/db';
import { users, admins, categories, tickets, ticketMessages, states, settings } from '../schema.js';
import { LIMITS, STATUS } from './config.js';

// ---------- users ----------

export async function getUser(tgId) {
  return await db.select().from(users).where(eq(users.tgId, tgId)).get();
}

// Insert or refresh a user on every interaction (username/names may change).
// Returns { user, isNew }.
export async function upsertUser(from) {
  const existing = await getUser(from.id);
  const patch = {
    username: from.username ?? null,
    firstName: from.first_name ?? null,
    lastName: from.last_name ?? null,
    lastSeen: new Date(),
  };
  if (!existing) {
    await db.insert(users).values({ tgId: from.id, ...patch }).run();
    return { user: await getUser(from.id), isNew: true };
  }
  await db.update(users).set(patch).where(eq(users.tgId, from.id)).run();
  return { user: { ...existing, ...patch }, isNew: false };
}

export async function setUserField(tgId, patch) {
  await db.update(users).set(patch).where(eq(users.tgId, tgId)).run();
}

export async function setLang(tgId, lang) {
  await setUserField(tgId, { lang });
}

// ---------- staff (owner + admins) ----------

// The owner is NOT hardcoded anywhere in the repository. The owner id lives
// in the settings table and is claimed once via /setup <key>, where <key>
// is generated on the operator's machine with: npx tgcloud run lib/setup-key

export async function getOwnerId() {
  const v = await getSetting('owner_id', null);
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function isOwner(tgId) {
  const ownerId = await getOwnerId();
  return ownerId !== null && tgId === ownerId;
}

export async function isAdmin(tgId) {
  if (await isOwner(tgId)) return true;
  const row = await db.select().from(admins).where(eq(admins.tgId, tgId)).get();
  return !!row;
}

export async function isStaff(tgId) {
  return await isAdmin(tgId);
}

export async function getAdminRows() {
  return await db.select().from(admins).orderBy(asc(admins.addedAt)).all();
}

// All staff chat ids (owner first, then admins) — deduped.
export async function getStaffIds() {
  const [ownerId, rows] = await Promise.all([getOwnerId(), getAdminRows()]);
  const ids = [ownerId, ...rows.map((r) => r.tgId)].filter((x) => Number.isInteger(x));
  return [...new Set(ids)];
}

export async function addAdmin(tgId, addedBy) {
  await db.insert(admins).values({ tgId, addedBy })
    .onConflictDoUpdate({ target: admins.tgId, set: { addedBy } }).run();
}

export async function removeAdmin(tgId) {
  await db.delete(admins).where(eq(admins.tgId, tgId)).run();
}

// ---------- states (per-chat flow machine) ----------

export async function getState(chatId) {
  const s = await db.select().from(states).where(eq(states.chatId, chatId)).get();
  if (!s) return null;
  const ageSec = (Date.now() - s.updated.getTime()) / 1000;
  if (ageSec > LIMITS.STATE_TTL) {
    await clearState(chatId);
    return null;
  }
  return s;
}

export async function setState(chatId, flow, data = {}) {
  await db.insert(states).values({ chatId, flow, data, updated: new Date() })
    .onConflictDoUpdate({ target: states.chatId, set: { flow, data, updated: new Date() } })
    .run();
}

export async function clearState(chatId) {
  await db.delete(states).where(eq(states.chatId, chatId)).run();
}

// ---------- settings (key/value) ----------

export async function getSetting(key, def = null) {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return def;
  return row.value ?? def;
}

export async function setSetting(key, value) {
  await db.insert(settings).values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

export async function catsEnabled() {
  return (await getSetting('cats_enabled', false)) === true;
}

// ---------- one-time owner-claim key (generated via the CLI) ----------

// Store a fresh claim key (upper-case) + expiry, and reset the fail counter.
export async function setSetupKey(key, ttlSec = LIMITS.SETUP_KEY_TTL) {
  await setSetting('setup_key', {
    key: String(key ?? '').trim().toUpperCase(),
    expiresAt: Date.now() + ttlSec * 1000,
  });
  await setSetting('setup_fails', 0);
}

// Try to claim ownership for tgId with <key>. Security:
//   • key must match the last one generated via the CLI (30-min TTL)
//   • brute-force guard: at most LIMITS.SETUP_MAX_FAILS wrong tries per key
//   • a valid claim also TRANSFERS ownership if an owner already exists
export async function claimOwnership(tgId, key) {
  const rec = await getSetting('setup_key', null);
  if (!rec || typeof rec !== 'object' || !rec.key) return false;
  const fails = Number(await getSetting('setup_fails', 0)) || 0;
  if (fails >= LIMITS.SETUP_MAX_FAILS) return false;
  if (Date.now() > Number(rec.expiresAt ?? 0)) return false;
  if (String(key ?? '').trim().toUpperCase() !== String(rec.key)) {
    await setSetting('setup_fails', fails + 1);
    return false;
  }
  await setSetting('owner_id', tgId);
  await setSetting('setup_key', null);   // single-use
  await setSetting('setup_fails', 0);
  return true;
}

// ---------- categories ----------

export async function listCategories(enabledOnly = false) {
  let q = db.select().from(categories);
  if (enabledOnly) q = q.where(eq(categories.isEnabled, true));
  return await q.orderBy(asc(categories.id)).all();
}

export async function getCategory(id) {
  return await db.select().from(categories).where(eq(categories.id, id)).get();
}

export async function addCategory(titleFa, titleEn) {
  const [row] = await db.insert(categories)
    .values({ titleFa, titleEn, isEnabled: true })
    .returning().run();
  return row;
}

export async function toggleCategory(id) {
  const cat = await getCategory(id);
  if (!cat) return null;
  await db.update(categories).set({ isEnabled: !cat.isEnabled }).where(eq(categories.id, id)).run();
  return !cat.isEnabled;
}

export async function deleteCategory(id) {
  await db.delete(categories).where(eq(categories.id, id)).run();
}

// Resolve a category title for display; falls back if the category was deleted.
export async function catTitle(id, lang) {
  if (!id) return lang === 'en' ? '—' : '—';
  const cat = await getCategory(id);
  if (!cat) return lang === 'en' ? '(deleted)' : '(حذف‌شده)';
  return lang === 'en' ? cat.titleEn : cat.titleFa;
}

// ---------- tickets ----------

export async function getTicket(id) {
  return await db.select().from(tickets).where(eq(tickets.id, id)).get();
}

// The user's currently active ticket (status open or answered) — newest first.
export async function activeTicketOf(userId) {
  return await db.select().from(tickets)
    .where(and(eq(tickets.userId, userId), inArray(tickets.status, [STATUS.OPEN, STATUS.ANSWERED])))
    .orderBy(desc(tickets.id)).get();
}

export async function lastUserTicket(userId) {
  return await db.select().from(tickets)
    .where(eq(tickets.userId, userId)).orderBy(desc(tickets.id)).get();
}

export async function createTicket({ userId, categoryId = null, createdBy = 'user' }) {
  const [row] = await db.insert(tickets)
    .values({ userId, categoryId, createdBy, status: createdBy === 'staff' ? STATUS.ANSWERED : STATUS.OPEN })
    .returning().run();
  await db.update(users).set({ ticketCount: sql`${users.ticketCount} + 1` })
    .where(eq(users.tgId, userId)).run();
  return row;
}

export async function updateTicket(id, patch) {
  await db.update(tickets).set({ ...patch, updated: new Date() }).where(eq(tickets.id, id)).run();
}

export async function closeTicket(id, closedBy) {
  await db.update(tickets)
    .set({ status: STATUS.CLOSED, closedBy, closedAt: new Date(), updated: new Date() })
    .where(eq(tickets.id, id)).run();
}

// FULL delete: ticket + every stored message (owner-only action; caller checks).
export async function deleteTicketFully(id) {
  await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, id));
  await db.delete(tickets).where(eq(tickets.id, id));
}

// Paginated ticket list. filter: { status?: 'open'|'answered'|'closed'|'all', userId? }
export async function listTickets(filter = {}, page = 1, per = LIMITS.LIST_PAGE) {
  const conds = [];
  if (filter.status && filter.status !== 'all') conds.push(eq(tickets.status, filter.status));
  if (filter.userId) conds.push(eq(tickets.userId, filter.userId));
  const where = conds.length ? (conds.length === 1 ? conds[0] : and(...conds)) : undefined;
  const total = await db.$count(tickets, where);
  let q = db.select().from(tickets);
  if (where) q = q.where(where);
  const rows = await q.orderBy(desc(tickets.updated))
    .limit(per).offset(Math.max(0, (page - 1) * per)).all();
  return { rows, total };
}

// ---------- ticket messages ----------

export async function addTicketMessage({ ticketId, senderId, senderRole, kind, text = null, fileId = null }) {
  const [row] = await db.insert(ticketMessages)
    .values({ ticketId, senderId, senderRole, kind, text, fileId })
    .returning().run();
  await db.update(tickets)
    .set({ updated: new Date(), msgCount: sql`${tickets.msgCount} + 1` })
    .where(eq(tickets.id, ticketId)).run();
  return row;
}

// Long texts are split into <= MAX_TEXT_LEN chunks, each its own row.
export async function addTextChunks({ ticketId, senderId, senderRole, text }) {
  const chunks = [];
  let rest = String(text ?? '');
  if (!rest.length) rest = ' ';
  while (rest.length > 0) {
    chunks.push(rest.slice(0, LIMITS.MAX_TEXT_LEN));
    rest = rest.slice(LIMITS.MAX_TEXT_LEN);
  }
  let last = null;
  for (const c of chunks) {
    last = await addTicketMessage({ ticketId, senderId, senderRole, kind: 'text', text: c, fileId: null });
  }
  return last;
}

// History page (page 1 = newest). Returns rows in chronological order + paging info.
export async function listMessages(ticketId, page = 1, per = LIMITS.HISTORY_PAGE) {
  const total = await db.$count(ticketMessages, eq(ticketMessages.ticketId, ticketId));
  const pages = Math.max(1, Math.ceil(total / per));
  page = Math.min(Math.max(1, page), pages);
  const rows = await db.select().from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(desc(ticketMessages.id))
    .limit(per).offset((page - 1) * per).all();
  return { rows: rows.reverse(), total, pages, page };
}

export async function lastMessageOf(ticketId) {
  return await db.select().from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(desc(ticketMessages.id)).get();
}

// Messages sent by a user within the last `seconds` (anti-flood window).
export async function recentMsgRate(userId, seconds = 60) {
  const since = new Date(Date.now() - seconds * 1000);
  return await db.$count(ticketMessages,
    and(eq(ticketMessages.senderId, userId), gte(ticketMessages.created, since)));
}

// ---------- search ----------

// q: numeric id | @username | name fragment
export async function searchUsers(q, limit = LIMITS.SEARCH_RESULTS) {
  const s = String(q ?? '').trim();
  if (!s) return [];
  if (/^\d+$/.test(s)) {
    const u = await getUser(Number(s));
    return u ? [u] : [];
  }
  if (s.startsWith('@')) {
    const name = s.slice(1).toLowerCase();
    if (!name) return [];
    return await db.select().from(users)
      .where(sql`lower(coalesce(${users.username}, '')) LIKE ${'%' + name + '%'}`)
      .limit(limit).all();
  }
  const pat = `%${s}%`;
  return await db.select().from(users)
    .where(or(
      sql`coalesce(${users.firstName}, '') LIKE ${pat}`,
      sql`coalesce(${users.lastName}, '') LIKE ${pat}`,
      sql`coalesce(${users.username}, '') LIKE ${pat}`,
    ))
    .orderBy(desc(users.lastSeen)).limit(limit).all();
}

// ---------- stats ----------

export async function ticketStats() {
  const [all, open, answered, closed, msgs] = await Promise.all([
    db.$count(tickets),
    db.$count(tickets, eq(tickets.status, STATUS.OPEN)),
    db.$count(tickets, eq(tickets.status, STATUS.ANSWERED)),
    db.$count(tickets, eq(tickets.status, STATUS.CLOSED)),
    db.$count(ticketMessages),
  ]);
  return { all, open, answered, closed, msgs };
}

export async function userStats() {
  const [total, banned, adminsN, catsN] = await Promise.all([
    db.$count(users),
    db.$count(users, eq(users.isBanned, true)),
    db.$count(admins),
    db.$count(categories),
  ]);
  return { total, banned, adminsN, catsN };
}
