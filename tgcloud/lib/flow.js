// ============================================================
// lib/flow.js — delivery & orchestration layer
// All Bot API traffic with error handling lives here:
//  • 403 "bot blocked by user"  → flagged, never crashes a fan-out
//  • 429 rate limit             → short wait + single retry
//  • "message is not modified"  → treated as success
// ============================================================
import { api, BotApiError } from 'sdk';
import { LIMITS, STATUS, extractContent } from './config.js';
import * as store from './store.js';
import { t } from './i18n.js';
import { esc, fmtDate, fullName, statusInfo, previewOf, btn, kb } from './ui.js';

// ---------- low-level safe API helpers ----------

export async function sleep(ms) {
  if (typeof setTimeout === 'function') {
    await new Promise((resolve) => setTimeout(resolve, ms));
  } else {
    // Sandbox without timers: bounded busy-wait (only used for 429, capped small).
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

function classify(e) {
  if (e instanceof BotApiError) {
    const blocked =
      e.code === 403 ||
      (e.code === 400 && String(e.description ?? '').toLowerCase().includes('chat not found'));
    if (!blocked) console.warn('BotApiError:', e.method, e.code, e.description);
    return { ok: false, blocked, desc: String(e.description ?? '') };
  }
  console.error('api error:', e);
  return { ok: false, blocked: false, desc: 'internal' };
}

// Run a Bot API call; on 429 wait retry_after (capped) and retry once.
async function apiSafe(call) {
  try {
    return { ok: true, res: await call() };
  } catch (e) {
    if (e instanceof BotApiError && e.code === 429) {
      const ra = Number(e.parameters?.retry_after ?? 1);
      const waitMs = Math.min(Number.isFinite(ra) ? ra : 1, LIMITS.RETRY_AFTER_CAP) * 1000;
      try { await sleep(waitMs); } catch { /* ignore */ }
      try { return { ok: true, res: await call() }; }
      catch (e2) { return classify(e2); }
    }
    return classify(e);
  }
}

export async function sendText(chatId, text, markup = undefined) {
  const params = { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  if (markup) params.reply_markup = markup;
  const r = await apiSafe(() => api.sendMessage(params));
  return { ok: r.ok, blocked: !!r.blocked };
}

export async function copyTo(chatId, fromChatId, messageId, markup = undefined) {
  const params = { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId };
  if (markup) params.reply_markup = markup;
  const r = await apiSafe(() => api.copyMessage(params));
  return { ok: r.ok, blocked: !!r.blocked };
}

// Edit a message we rendered; falls back to sending a fresh message.
export async function editOrSend(chatId, messageId, text, markup = undefined) {
  const params = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  if (markup) params.reply_markup = markup;
  const r = await apiSafe(() => api.editMessageText(params));
  if (r.ok) return true;
  if (r.desc && r.desc.toLowerCase().includes('not modified')) return true;
  await sendText(chatId, text, markup);
  return true;
}

export async function answerCb(cbId, text = undefined, alert = false) {
  const params = { callback_query_id: cbId };
  if (text) { params.text = String(text).slice(0, 190); params.show_alert = !!alert; }
  try { await api.answerCallbackQuery(params); } catch { /* never critical */ }
}

// ---------- staff fan-out ----------

// Send to every staff member with THEIR OWN language. build(lang) -> {text, markup?}
export async function notifyStaffLocalized(build, exceptId = null) {
  for (const sid of await store.getStaffIds()) {
    if (exceptId && sid === exceptId) continue;
    const su = await store.getUser(sid);
    const lang = su?.lang ?? 'fa';
    const { text, markup } = build(lang);
    await sendText(sid, text, markup);
  }
}

function staffHeader(lang, ticket, user, cat) {
  const name = esc(fullName(user));
  const uname = user?.username ? ' (@' + esc(user.username) + ')' : '';
  let s = `${t(lang, 'hdr_user')}\n👤 ${name}${uname} | 🆔 <code>${user.tgId}</code>`;
  s += `\n🎫 #${ticket.id} | 🕐 ${fmtDate(new Date(), lang)}`;
  if (cat) s += ` | 🏷 ${esc(cat)}`;
  return s;
}

function staffActionsKb(lang, ticketId) {
  return kb(
    [btn(t(lang, 'btn_view'), `a:view:${ticketId}`), btn(t(lang, 'btn_reply'), `a:reply:${ticketId}`)],
    [btn(t(lang, 'btn_close'), `a:close:${ticketId}`)],
  );
}

// ---------- core operations (used by message.js & callback_query.js) ----------

// USER: create a ticket from the pending "u_new_ticket" flow.
// If an active ticket appeared in the meantime (race), the message is merged
// into it instead of creating a duplicate.
export async function userCreatesTicket(user, msg, categoryId = null) {
  const existingActive = await store.activeTicketOf(user.tgId);
  if (existingActive) {
    await storeTicketContent(existingActive.id, user.tgId, 'user', msg);
    await store.updateTicket(existingActive.id, { status: STATUS.OPEN });
    await relayUserToStaff(existingActive, user, msg);
    return { ok: true, ticketId: existingActive.id, merged: true };
  }
  const last = await store.lastUserTicket(user.tgId);
  if (last) {
    const waitSec = LIMITS.NEW_TICKET_COOLDOWN - (Date.now() - last.created.getTime()) / 1000;
    if (waitSec > 0) return { ok: false, reason: 'cooldown', waitSec: Math.ceil(waitSec) };
  }
  const ticket = await store.createTicket({ userId: user.tgId, categoryId, createdBy: 'user' });
  await storeTicketContent(ticket.id, user.tgId, 'user', msg);
  await store.updateTicket(ticket.id, { status: STATUS.OPEN });
  await relayUserToStaff(ticket, user, msg);
  return { ok: true, ticketId: ticket.id };
}

// USER: append a message to the active ticket + notify staff.
export async function appendUserMessage(user, ticket, msg) {
  const rate = await store.recentMsgRate(user.tgId, 60);
  if (rate >= LIMITS.MSGS_PER_MIN) return { ok: false, reason: 'flood' };
  await storeTicketContent(ticket.id, user.tgId, 'user', msg);
  await store.updateTicket(ticket.id, { status: STATUS.OPEN });
  await relayUserToStaff(ticket, user, msg);
  return { ok: true, ticketId: ticket.id };
}

// STAFF: reply inside an a_reply flow.
export async function staffReply(staffUser, ticketId, msg) {
  const ticket = await store.getTicket(ticketId);
  if (!ticket) return { ok: false, reason: 'gone' };
  if (ticket.status === STATUS.CLOSED) return { ok: false, reason: 'closed' };
  const target = await store.getUser(ticket.userId);
  if (!target) return { ok: false, reason: 'gone' };
  if (target.isBanned) return { ok: false, reason: 'banned' };

  await storeTicketContent(ticket.id, staffUser.tgId, 'staff', msg);
  await store.updateTicket(ticket.id, { status: STATUS.ANSWERED });

  const delivered = await deliverStaffMsgToUser(ticket, staffUser, msg);
  if (!delivered.ok) return { ok: false, reason: delivered.reason, ticketId: ticket.id };

  // Let other staff see the reply (sender excluded).
  const staffName = esc(fullName(staffUser));
  const senderChat = msg.chat.id;
  for (const sid of await store.getStaffIds()) {
    if (sid === staffUser.tgId || sid === senderChat) continue;
    const su = await store.getUser(sid);
    const l = su?.lang ?? 'fa';
    const note = t(l, 'staff_replied_note', { name: staffName, id: ticket.id });
    const h = await sendText(sid, note);
    if (!h.blocked) await copyTo(sid, msg.chat.id, msg.message_id);
  }
  return { ok: true, ticketId: ticket.id };
}

// STAFF: open a ticket to a user (by id/username flow), msg = first content.
export async function staffOpenTicket(staffUser, target, msg) {
  let ticket = await store.activeTicketOf(target.tgId);
  let isNew = false;
  if (!ticket) {
    ticket = await store.createTicket({ userId: target.tgId, categoryId: null, createdBy: 'staff' });
    isNew = true;
  }
  await storeTicketContent(ticket.id, staffUser.tgId, 'staff', msg);
  await store.updateTicket(ticket.id, { status: STATUS.ANSWERED });

  const delivered = await deliverStaffMsgToUser(ticket, staffUser, msg);
  if (!delivered.ok) {
    if (isNew) await store.closeTicket(ticket.id, staffUser.tgId);
    return { ok: false, reason: delivered.reason, ticketId: ticket.id, isNew };
  }
  return { ok: true, ticketId: ticket.id, isNew };
}

// Deliver a staff message (already stored) to the ticket owner.
async function deliverStaffMsgToUser(ticket, staffUser, msg) {
  const user = await store.getUser(ticket.userId);
  if (!user) return { ok: false, reason: 'gone' };
  if (user.isBanned) return { ok: false, reason: 'banned' };
  const lang = user.lang ?? 'fa';
  const header = t(lang, 'hdr_reply', { id: ticket.id });
  const markup = kb([
    btn(t(lang, 'btn_mine'), 'u:mine:1'),
    btn(t(lang, 'btn_close'), `u:close:${ticket.id}`),
  ]);
  const h = await sendText(user.tgId, header, markup);
  if (h.blocked) {
    await store.setUserField(user.tgId, { blockedBot: true });
    return { ok: false, reason: 'blocked' };
  }
  const c = await copyTo(user.tgId, msg.chat.id, msg.message_id);
  if (c.blocked) {
    await store.setUserField(user.tgId, { blockedBot: true });
    return { ok: false, reason: 'blocked' };
  }
  return { ok: true };
}

// Relay any user message to all staff: localized header + copy of the original.
export async function relayUserToStaff(ticket, user, msg) {
  const cat = await store.catTitle(ticket.categoryId, 'fa');
  for (const sid of await store.getStaffIds()) {
    const su = await store.getUser(sid);
    const lang = su?.lang ?? 'fa';
    const header = staffHeader(lang, ticket, user, cat);
    const markup = staffActionsKb(lang, ticket.id);
    const h = await sendText(sid, header, markup);
    if (!h.blocked) await copyTo(sid, msg.chat.id, msg.message_id);
  }
}

// Store message content (text chunked / media with file_id).
export async function storeTicketContent(ticketId, senderId, senderRole, msg) {
  const content = extractContent(msg);
  if (content.kind === 'text') {
    await store.addTextChunks({ ticketId, senderId, senderRole, text: content.text ?? '' });
  } else {
    await store.addTicketMessage({
      ticketId, senderId, senderRole,
      kind: content.kind, text: content.text, fileId: content.fileId,
    });
  }
}

// Close by staff: notify the user + other staff.
export async function closeByStaff(ticket, staffUser) {
  await store.closeTicket(ticket.id, staffUser.tgId);
  const user = await store.getUser(ticket.userId);
  if (user && !user.blockedBot) {
    const l = user.lang ?? 'fa';
    await sendText(user.tgId, t(l, 'u_closed_by_staff', { id: ticket.id }),
      kb([btn(t(l, 'btn_mine'), 'u:mine:1'), btn(t(l, 'btn_new'), 'u:new')]));
  }
  const staffName = esc(fullName(staffUser));
  await notifyStaffLocalized((l) => ({ text: t(l, 'staff_closed_note', { name: staffName, id: ticket.id }) }),
    staffUser.tgId);
}

// Close by the ticket owner (the user themself): notify staff.
export async function closeByUser(ticket, user) {
  await store.closeTicket(ticket.id, user.tgId);
  await notifyStaffLocalized((l) => ({ text: t(l, 'closed_user_note', { id: ticket.id }) }));
}

// OWNER-only: wipe ticket + messages; notify the user if reachable.
export async function deleteTicketFully(ticket, actorLang) {
  const user = await store.getUser(ticket.userId);
  const wasActive = ticket.status !== STATUS.CLOSED;
  await store.deleteTicketFully(ticket.id);
  if (user && wasActive && !user.blockedBot) {
    const l = user.lang ?? 'fa';
    await sendText(user.tgId, t(l, 'u_deleted', { id: ticket.id }));
  }
  void actorLang;
}

// Reopen a closed ticket (staff action): status back to "awaiting user".
export async function reopenTicket(ticket, staffUser) {
  await store.updateTicket(ticket.id, { status: STATUS.ANSWERED, closedBy: null, closedAt: null });
  const user = await store.getUser(ticket.userId);
  if (user && !user.blockedBot) {
    const l = user.lang ?? 'fa';
    await sendText(user.tgId, t(l, 'u_reopened', { id: ticket.id }));
  }
}

// Build the staff ticket card text (fresh from db).
export async function staffTicketCard(ticket, lang) {
  const u = await store.getUser(ticket.userId);
  const cat = await store.catTitle(ticket.categoryId, lang);
  const lm = await store.lastMessageOf(ticket.id);
  const si = statusInfo(ticket.status, lang);
  return t(lang, 's_card', {
    id: ticket.id,
    status: `${si.emoji} ${si.label}`,
    user: esc(fullName(u)),
    uid: ticket.userId,
    cat: esc(cat),
    date: fmtDate(ticket.created, lang),
    updated: fmtDate(ticket.updated, lang),
    n: ticket.msgCount,
    src: t(lang, ticket.createdBy === 'staff' ? 'src_staff' : 'src_user'),
    preview: esc(previewOf(lm, lang, LIMITS.PREVIEW_LEN)),
  });
}

// Build the staff user-profile card text.
export async function staffUserCard(target, lang) {
  const active = await store.activeTicketOf(target.tgId);
  const { total } = await store.listTickets({ userId: target.tgId }, 1, 1);
  return t(lang, 'user_card', {
    name: esc(fullName(target)),
    username: target.username ? esc(target.username) : t(lang, 'unknown'),
    id: target.tgId,
    lang: (target.lang ?? '—') === 'en' ? 'English' : (target.lang ? 'فارسی' : '—'),
    created: fmtDate(target.created, lang),
    seen: fmtDate(target.lastSeen, lang),
    n: total,
    a: active ? 1 : 0,
    ban: target.isBanned ? t(lang, 'ban_lbl') : t(lang, 'clean_lbl'),
  });
}
