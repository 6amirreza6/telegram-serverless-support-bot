// ============================================================
// handlers/message.js — main router for every incoming message.
//
// Flow: private chats only → upsert user → banned = silence →
// new users pick a language → /commands → per-chat state machine
// → staff routes (reply/search/open-id/open-un/open-msg/admin-add/
// category-add) or user routes (new ticket / append to active ticket).
// ============================================================
import { api } from 'sdk';
import * as store from '../lib/store.js';
import { LIMITS } from '../lib/config.js';
import { t, normLang } from '../lib/i18n.js';
import {
  esc, fullName, userMenuKb, langPromptKb, staffPanelKb, staffPanelText,
} from '../lib/ui.js';
import {
  sendText, userCreatesTicket, appendUserMessage, staffReply,
  staffOpenTicket,
} from '../lib/flow.js';

function cmdOf(text) {
  if (!text || !text.startsWith('/')) return null;
  const m = /^\/([a-z0-9_]+)/i.exec(text.trim());
  return m ? m[1].toLowerCase() : null;
}

function argOf(text) {
  if (!text) return '';
  const idx = text.indexOf(' ');
  return idx === -1 ? '' : text.slice(idx + 1).trim();
}

async function syncCommands(chatId, lang, staff) {
  const commands = staff
    ? [
        { command: 'panel', description: t(lang, 'cmd_panel') },
        { command: 'search', description: t(lang, 'cmd_search') },
        { command: 'open', description: t(lang, 'cmd_open') },
        { command: 'stats', description: t(lang, 'cmd_stats') },
        { command: 'cancel', description: t(lang, 'cmd_cancel') },
      ]
    : [
        { command: 'start', description: t(lang, 'cmd_start') },
        { command: 'menu', description: t(lang, 'cmd_menu') },
        { command: 'cancel', description: t(lang, 'cmd_cancel') },
        { command: 'id', description: t(lang, 'cmd_id') },
      ];
  try {
    await api.setMyCommands({ commands, scope: { type: 'chat', chat_id: chatId } });
  } catch { /* cosmetic only */ }
}

async function sendUserMenu(user, lang) {
  const active = await store.activeTicketOf(user.tgId);
  const text = active
    ? t(lang, 'menu_active_line', { id: active.id, status: t(lang, active.status === 'answered' ? 'st_answered' : 'st_open') })
    : t(lang, 'menu_no_active');
  await sendText(user.tgId, text, userMenuKb(lang, active));
}

async function sendStaffPanel(user, lang) {
  const ts = await store.ticketStats();
  const us = await store.userStats();
  const counts = { open: ts.open, answered: ts.answered, all: ts.all, closed: ts.closed, users: us.total };
  await sendText(user.tgId, staffPanelText(lang, counts), staffPanelKb(lang, counts, await store.isOwner(user.tgId)));
}

async function showHelp(user, lang, staff) {
  await sendText(user.tgId, t(lang, staff ? 'help_staff' : 'help_user', { btn_new: t(lang, 'btn_new'), btn_mine: t(lang, 'btn_mine') }));
}

// ---------- user text/media routing ----------

async function userRoute(user, lang, st, msg) {
  if (st?.flow === 'u_new_ticket') {
    const r = await userCreatesTicket(user, msg, st.data?.catId ?? null);
    if (r.ok) {
      await store.clearState(user.tgId);
      await sendText(user.tgId, t(lang, r.merged ? 'ack_append' : 'ticket_created', { id: r.ticketId }));
    } else if (r.reason === 'cooldown') {
      await sendText(user.tgId, t(lang, 'cooldown', { n: r.waitSec }));
    } else {
      await sendText(user.tgId, t(lang, 'err_generic'));
    }
    return;
  }
  const active = await store.activeTicketOf(user.tgId);
  if (active) {
    const r = await appendUserMessage(user, active, msg);
    if (!r.ok && r.reason === 'flood') {
      await sendText(user.tgId, t(lang, 'flood', { n: LIMITS.MSGS_PER_MIN }));
    } else if (r.ok) {
      await sendText(user.tgId, t(lang, 'ack_append', { id: active.id }));
    }
    return;
  }
  await sendText(user.tgId, t(lang, 'menu_no_active'), userMenuKb(lang, null));
}

// ---------- staff text/media routing ----------

async function resolveTargetByInput(user, lang, input) {
  const s = String(input ?? '').trim();
  if (!s) return { target: null, error: 'invalid_id' };
  if (/^\d+$/.test(s)) {
    const target = await store.getUser(Number(s));
    if (!target) return { target: null, error: 'user_not_found' };
    return { target, error: null };
  }
  const results = await store.searchUsers(s.startsWith('@') ? s : '@' + s, 2);
  if (!results.length) return { target: null, error: 'user_not_found' };
  return { target: results[0], error: null };
}

function targetBlockReason(target) {
  if (!target) return 'user_not_found';
  if (target.isBanned) return 'target_banned';
  if (target.blockedBot) return 'target_blocked';
  return null;
}

async function staffRoute(user, lang, st, msg, text) {
  switch (st?.flow) {
    case 'a_reply': {
      const tid = Number(st.data?.tid);
      if (!Number.isInteger(tid)) { await store.clearState(user.tgId); await sendText(user.tgId, t(lang, 'err_generic')); return; }
      const r = await staffReply(user, tid, msg);
      if (r.ok) { await sendText(user.tgId, '✅'); return; }
      await store.clearState(user.tgId);
      if (r.reason === 'gone') await sendText(user.tgId, t(lang, 'ticket_gone'));
      else if (r.reason === 'closed') await sendText(user.tgId, t(lang, 't_already_closed'));
      else if (r.reason === 'banned') await sendText(user.tgId, t(lang, 'target_banned'));
      else if (r.reason === 'blocked') await sendText(user.tgId, t(lang, 'fail_blocked'));
      else await sendText(user.tgId, t(lang, 'err_generic'));
      return;
    }
    case 'a_search':
    case 'a_search_res': {
      if (!text) { await sendText(user.tgId, t(lang, 'search_prompt')); return; }
      await runSearch(user, lang, text);
      return;
    }
    case 'a_open_id': {
      if (!text || !/^\d+$/.test(text.trim())) { await sendText(user.tgId, t(lang, 'invalid_id')); return; }
      const target = await store.getUser(Number(text.trim()));
      const reason = targetBlockReason(target);
      if (reason) { await sendText(user.tgId, t(lang, reason)); return; }
      await store.setState(user.tgId, 'a_open_msg', { uid: target.tgId });
      await sendText(user.tgId, t(lang, 'open_msg_prompt', { name: esc(fullName(target)) }));
      return;
    }
    case 'a_open_un': {
      if (!text) { await sendText(user.tgId, t(lang, 'open_un_prompt')); return; }
      const { target, error } = await resolveTargetByInput(user, lang, text);
      const reason = targetBlockReason(target);
      if (error || reason) { await sendText(user.tgId, t(lang, error ?? reason)); return; }
      await store.setState(user.tgId, 'a_open_msg', { uid: target.tgId });
      await sendText(user.tgId, t(lang, 'open_msg_prompt', { name: esc(fullName(target)) }));
      return;
    }
    case 'a_open_msg': {
      const target = await store.getUser(Number(st.data?.uid));
      const reason = targetBlockReason(target);
      if (reason) { await store.clearState(user.tgId); await sendText(user.tgId, t(lang, reason)); return; }
      const r = await staffOpenTicket(user, target, msg);
      await store.clearState(user.tgId);
      if (r.ok) {
        await sendText(user.tgId, t(lang, r.isNew ? 'opened_new' : 'opened_existing', { id: r.ticketId }));
      } else if (r.reason === 'blocked') {
        await sendText(user.tgId, t(lang, r.isNew ? 'open_failed' : 'fail_blocked'));
      } else {
        await sendText(user.tgId, t(lang, 'err_generic'));
      }
      return;
    }
    case 'a_admin_add': {
      if (!(await store.isOwner(user.tgId))) { await store.clearState(user.tgId); await sendText(user.tgId, t(lang, 'access_denied')); return; }
      await addAdminFlow(user, lang, text ?? '');
      return;
    }
    case 'a_cat_fa': {
      if (!(await store.isOwner(user.tgId)) || !text || !text.trim()) { await store.clearState(user.tgId); await sendText(user.tgId, t(lang, 'cancelled')); return; }
      await store.setState(user.tgId, 'a_cat_en', { fa: text.trim().slice(0, 64) });
      await sendText(user.tgId, t(lang, 'cat_en_prompt'));
      return;
    }
    case 'a_cat_en': {
      if (!(await store.isOwner(user.tgId)) || !text || !text.trim()) { await store.clearState(user.tgId); await sendText(user.tgId, t(lang, 'cancelled')); return; }
      const fa = String(st.data?.fa ?? '').trim().slice(0, 64);
      if (!fa) { await store.clearState(user.tgId); await sendText(user.tgId, t(lang, 'err_generic')); return; }
      const cat = await store.addCategory(fa, text.trim().slice(0, 64));
      await store.clearState(user.tgId);
      await sendText(user.tgId, t(lang, 'cat_added', { t: esc(cat.titleFa) }));
      return;
    }
    default: {
      await sendStaffPanel(user, lang);
    }
  }
}

async function runSearch(user, lang, query) {
  const results = await store.searchUsers(query, 8);
  if (!results.length) {
    await store.setState(user.tgId, 'a_search_res', { q: query });
    await sendText(user.tgId, t(lang, 'no_result'));
    return;
  }
  await store.setState(user.tgId, 'a_search_res', { q: query });
  const rows = results.map((u, i) => ([{
    text: `${i + 1}. ${fullName(u).slice(0, 24)}${u.username ? ' @' + u.username.slice(0, 14) : ''}`,
    callback_data: `a:user:${u.tgId}`,
  }]));
  rows.push([{ text: t(lang, 'btn_panel'), callback_data: 'a:panel' }]);
  await sendText(user.tgId, t(lang, 'results_title'), { inline_keyboard: rows });
}

async function addAdminFlow(owner, lang, input) {
  const { target, error } = await resolveTargetByInput(owner, lang, input);
  if (error || !target) { await store.clearState(owner.tgId); await sendText(owner.tgId, t(lang, error ?? 'user_not_found')); return; }
  if (await store.isOwner(target.tgId)) { await store.clearState(owner.tgId); await sendText(owner.tgId, t(lang, 'admin_is_owner')); return; }
  if (await store.isAdmin(target.tgId)) { await store.clearState(owner.tgId); await sendText(owner.tgId, t(lang, 'admin_exists')); return; }
  await store.addAdmin(target.tgId, owner.tgId);
  await store.clearState(owner.tgId);
  await sendText(owner.tgId, t(lang, 'admin_added', { name: esc(fullName(target)) }));
}

// ---------- /commands ----------

async function handleCommand(cmd, arg, user, lang, staff) {
  const chatId = user.tgId;
  switch (cmd) {
    case 'start':
    case 'menu': {
      await store.clearState(chatId);
      await syncCommands(chatId, lang, staff);
      if (staff) await sendStaffPanel(user, lang);
      else await sendUserMenu(user, lang);
      return;
    }
    case 'cancel': {
      await store.clearState(chatId);
      await sendText(chatId, t(lang, 'cancelled'));
      if (staff) await sendStaffPanel(user, lang); else await sendUserMenu(user, lang);
      return;
    }
    case 'id': {
      await sendText(chatId, `<code>${chatId}</code>`);
      return;
    }
    case 'help': {
      await showHelp(user, lang, staff);
      return;
    }
    case 'lang': {
      await store.clearState(chatId);
      await sendText(chatId, t(lang, 'lang_prompt'), langPromptKb());
      return;
    }
    case 'panel': {
      if (!staff) break;
      await store.clearState(chatId);
      await sendStaffPanel(user, lang);
      return;
    }
    case 'search': {
      if (!staff) break;
      if (arg) await runSearch(user, lang, arg);
      else {
        await store.setState(chatId, 'a_search', {});
        await sendText(chatId, t(lang, 'search_prompt'));
      }
      return;
    }
    case 'open': {
      if (!staff) break;
      if (!arg) {
        await store.setState(chatId, 'a_open_id', {});
        await sendText(chatId, t(lang, 'open_id_prompt'));
        return;
      }
      const { target, error } = await resolveTargetByInput(user, lang, arg);
      if (error || !target) { await sendText(chatId, t(lang, error ?? 'user_not_found')); return; }
      const reason = targetBlockReason(target);
      if (reason) { await sendText(chatId, t(lang, reason)); return; }
      await store.setState(chatId, 'a_open_msg', { uid: target.tgId });
      await sendText(chatId, t(lang, 'open_msg_prompt', { name: esc(fullName(target)) }));
      return;
    }
    case 'stats': {
      if (!staff) break;
      const ts = await store.ticketStats();
      const us = await store.userStats();
      const enabled = await store.catsEnabled();
      await sendText(chatId, t(lang, 'stats_text', {
        users: us.total, banned: us.banned, all: ts.all, open: ts.open,
        ans: ts.answered, closed: ts.closed, msgs: ts.msgs,
        admins: us.adminsN, cats: us.catsN,
        catsState: t(lang, enabled ? 'cats_on' : 'cats_off'),
      }));
      return;
    }
    case 'cats': {
      if (!(await store.isOwner(user.tgId))) break;
      // Panel is rendered by callback handler; here we render a minimal text version.
      const enabled = await store.catsEnabled();
      const cats = await store.listCategories(false);
      const lines = cats.map((c) => `${c.isEnabled ? '✅' : '❌'} #${c.id} ${esc(c.titleFa)} / ${esc(c.titleEn)}`);
      await sendText(chatId, t(lang, 'cats_title', { state: t(lang, enabled ? 'cats_on' : 'cats_off'), state_hint: t(lang, enabled ? 'state_hint_on' : 'state_hint_off') })
        + (lines.length ? '\n\n' + lines.join('\n') : '\n\n' + t(lang, 'empty')));
      return;
    }
    case 'admins': {
      if (!(await store.isOwner(user.tgId))) break;
      const rows = await store.getAdminRows();
      const lines = [];
      for (const a of rows) {
        const u = await store.getUser(a.tgId);
        lines.push(`• ${esc(fullName(u))} — <code>${a.tgId}</code> (@${esc(u?.username ?? '—')})`);
      }
      await sendText(chatId, t(lang, 'admins_title', { n: rows.length }) + (lines.length ? '\n' + lines.join('\n') : '\n' + t(lang, 'empty')));
      return;
    }
    default: break;
  }
  // Unknown command
  if (staff) await sendStaffPanel(user, lang);
  else await sendUserMenu(user, lang);
}

// One-time owner claim: /setup <key> — <key> is generated on the operator's
// machine via the CLI (npx tgcloud run lib/setup-key) and never stored in git.
// Must run BEFORE the language gate, because the claimer may be a first-time
// contact who has not picked a language yet. Replies are bilingual on purpose.
async function handleSetup(arg, user) {
  const chatId = user.tgId;
  if (!arg) {
    // Hint only while no owner exists — otherwise treat as an unknown command.
    if (await store.getOwnerId()) return false;
    await sendText(chatId,
      t('fa', 'setup_hint') + '\n—\n' + t('en', 'setup_hint'));
    return true;
  }
  const ok = await store.claimOwnership(chatId, arg);
  if (!ok) {
    await sendText(chatId, t('fa', 'setup_failed') + '\n—\n' + t('en', 'setup_failed'));
    return true;
  }
  await store.clearState(chatId);
  const lang = normLang(user.lang ?? 'fa');
  await syncCommands(chatId, lang, true);
  if (user.lang) {
    await sendText(chatId, t(lang, 'setup_done'));
    await sendStaffPanel(user, lang);   // owner buttons now included
  } else {
    await sendText(chatId, t('fa', 'setup_done') + '\n—\n' + t('en', 'setup_done'));
    await sendText(chatId, t('fa', 'lang_prompt'), langPromptKb());
  }
  return true;
}

// ---------- entry point ----------

export default async function (msg) {
  // (entry point)
  let chatId = 0;
  try {
    if (!msg || !msg.from || !msg.chat || msg.chat.type !== 'private') return;
    if (msg.from.is_bot) return;
    chatId = msg.chat.id;

    const { user, isNew } = await store.upsertUser(msg.from);
    const staff = await store.isStaff(user.tgId);
    const lang = staff ? normLang(user.lang ?? 'fa') : normLang(user.lang);

    // Banned users get total silence (anti-spam).
    if (!staff && user.isBanned) return;

    const cmd = cmdOf(msg.text);

    // Owner claim works even before a language is chosen / owner exists.
    if (cmd === 'setup') {
      await handleSetup(argOf(msg.text), user);
      return;
    }

    // First contact: language selection comes first (user side).
    if (!staff && !user.lang) {
      await store.clearState(chatId);
      await sendText(chatId, t(lang, 'lang_prompt'), langPromptKb());
      return;
    }

    if (cmd) {
      await handleCommand(cmd, argOf(msg.text), user, lang, staff);
      return;
    }

    const st = await store.getState(chatId);
    if (staff) await staffRoute(user, lang, st, msg, msg.text ?? null);
    else await userRoute(user, lang, st, msg);
  } catch (e) {
    console.error('message handler failed:', e);
    try { if (chatId) await api.sendMessage({ chat_id: chatId, text: '⚠️' }); } catch { /* ignore */ }
  }
}
