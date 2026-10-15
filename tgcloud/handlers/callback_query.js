// ============================================================
// handlers/callback_query.js — every inline button of the bot.
//
// Namespaces:
//   u:*  → user side (menu, tickets, language)
//   a:*  → staff side (panel, lists, ticket actions, search,
//          open-ticket flows, ban, admins, categories)
// Guards: staff check on a:*, owner check on owner-only actions,
// ownership check on user ticket views, stale-callback re-validation.
// ============================================================
import * as store from '../lib/store.js';
import { LIMITS, STATUS } from '../lib/config.js';
import { t, normLang } from '../lib/i18n.js';
import {
  esc, fullName, fmtDate, statusInfo, userMenuKb, langPromptKb, historyText,
  previewOf, ticketItemBtn, staffPanelText, staffPanelKb, staffTicketKb,
  staffUserKb, confirmKb, btn, kb,
} from '../lib/ui.js';
import {
  sendText, editOrSend, answerCb, closeByStaff, closeByUser,
  deleteTicketFully, reopenTicket, staffTicketCard, staffUserCard,
} from '../lib/flow.js';

const int = (s) => {
  const n = Number(s);
  return Number.isInteger(n) && Number.isFinite(n) ? n : null;
};

export default async function (cb) {
  try {
    if (!cb || !cb.from || !cb.data) return;
    const msg = cb.message;
    if (!msg) { await answerCb(cb.id); return; }        // button lives in an inaccessible message
    const chatId = msg.chat?.id ?? cb.from.id;
    const msgId = msg.message_id;

    const { user } = await store.upsertUser(cb.from);
    const staff = await store.isStaff(user.tgId);
    const lang = staff ? normLang(user.lang ?? 'fa') : normLang(user.lang);
    const uid = user.tgId;

    const render = (text, markup) => editOrSend(chatId, msgId, text, markup);
    const say = (t2, alert = false) => answerCb(cb.id, t2, alert);
    const deny = () => say(t(lang, 'access_denied'), true);

    const parts = cb.data.split(':');
    const ns = parts[0];

    // ================= USER SIDE =================
    if (ns === 'u') {
      if (!staff && user.isBanned) { await answerCb(cb.id); return; }
      const action = parts[1];

      if (action === 'lang') {
        const l = parts[2] === 'en' ? 'en' : 'fa';
        const firstTime = !user.lang;
        await store.setLang(uid, l);
        await store.clearState(chatId);
        await say(t(l, 'lang_changed'));
        if (firstTime) {
          await render(t(l, 'welcome', { name: esc(fullName(user)), btn_new: t(l, 'btn_new') }), userMenuKb(l, null));
        } else {
          const active = await store.activeTicketOf(uid);
          const text = active
            ? t(l, 'menu_active_line', { id: active.id, status: t(l, active.status === STATUS.ANSWERED ? 'st_answered' : 'st_open') })
            : t(l, 'menu_no_active');
          await render(text, userMenuKb(l, active));
        }
        return;
      }

      if (action === 'langsel') {
        await store.clearState(chatId);
        await render(t(lang, 'lang_prompt'), langPromptKb());
        await say('🌐');
        return;
      }

      if (action === 'help') {
        await render(t(lang, 'help_user', { btn_new: t(lang, 'btn_new'), btn_mine: t(lang, 'btn_mine') }),
          kb([btn(t(lang, 'btn_home'), 'u:menu')]));
        await say('ℹ️');
        return;
      }

      if (action === 'menu') {
        await store.clearState(chatId);
        const active = await store.activeTicketOf(uid);
        const text = active
          ? t(lang, 'menu_active_line', { id: active.id, status: t(lang, active.status === STATUS.ANSWERED ? 'st_answered' : 'st_open') })
          : t(lang, 'menu_no_active');
        await render(text, userMenuKb(lang, active));
        await say('🏠');
        return;
      }

      if (action === 'new') {
        if (staff) { await say(t(lang, 'staff_hint'), true); return; }
        await store.clearState(chatId);
        const active = await store.activeTicketOf(uid);
        if (active) {
          await render(t(lang, 'active_exists', { id: active.id }),
            kb([
              [btn(t(lang, 'btn_active', { id: active.id }), `u:view:${active.id}`)],
              [btn(t(lang, 'btn_close'), `u:close:${active.id}`)],
            ]));
          await say('ℹ️');
          return;
        }
        const enabled = await store.catsEnabled();
        const cats = enabled ? await store.listCategories(true) : [];
        if (cats.length) {
          const rows = cats.map((c) => ([btn(
            `${esc(lang === 'en' ? c.titleEn : c.titleFa)}`,
            `u:cat:${c.id}`,
          )]));
          rows.push([btn(t(lang, 'cat_none'), 'u:cat:0')]);
          await render(t(lang, 'choose_cat'), kb(...rows));
        } else {
          await store.setState(chatId, 'u_new_ticket', { catId: null });
          await render(t(lang, 'new_ask'), kb([btn(t(lang, 'btn_no'), 'u:menu')]));
        }
        await say('🎫');
        return;
      }

      if (action === 'cat') {
        const catId = int(parts[2]);
        if (catId === null) { await say(t(lang, 'err_generic'), true); return; }
        if (catId > 0) {
          const cat = await store.getCategory(catId);
          if (!cat || !cat.isEnabled) { await say(t(lang, 'err_generic'), true); return; }
        }
        await store.setState(chatId, 'u_new_ticket', { catId: catId > 0 ? catId : null });
        await render(t(lang, 'new_ask'), kb([btn(t(lang, 'btn_no'), 'u:menu')]));
        await say('✍️');
        return;
      }

      if (action === 'mine') {
        const page = Math.max(1, int(parts[2]) ?? 1);
        const { rows, total } = await store.listTickets({ userId: uid }, page, LIMITS.LIST_PAGE);
        const pages = Math.max(1, Math.ceil(total / LIMITS.LIST_PAGE));
        const p = Math.min(page, pages);
        const kbRows = [];
        for (const tk of rows) {
          const lm = await store.lastMessageOf(tk.id);
          const si = statusInfo(tk.status, lang);
          const prev = previewOf(lm, lang, 24);
          kbRows.push([{ text: `#${tk.id} ${si.emoji} ${esc(prev)}`, callback_data: `u:view:${tk.id}` }]);
        }
        if (!rows.length) kbRows.push([{ text: t(lang, 'empty'), callback_data: 'u:menu' }]);
        const nav = [];
        if (p > 1) nav.push(btn('◀️', `u:mine:${p - 1}`));
        nav.push(btn(t(lang, 'btn_home'), 'u:menu'));
        if (p < pages) nav.push(btn('▶️', `u:mine:${p + 1}`));
        kbRows.push(nav);
        await render(t(lang, 'mine_title', { page: p, pages }), kb(...kbRows));
        await say('📂');
        return;
      }

      if (action === 'view' || action === 'closen') {
        const tid = int(parts[2]);
        const tk = tid === null ? null : await store.getTicket(tid);
        if (!tk || tk.userId !== uid) { await say(t(lang, 'not_your_ticket'), true); return; }
        const cat = await store.catTitle(tk.categoryId, lang);
        const si = statusInfo(tk.status, lang);
        const text = t(lang, 'u_card', {
          id: tk.id, status: `${si.emoji} ${si.label}`, cat: esc(cat),
          date: fmtDate(tk.created, lang), n: tk.msgCount,
        });
        const rows = [[btn(t(lang, 'btn_history'), `u:hist:${tk.id}:1`)]];
        if (tk.status !== STATUS.CLOSED) rows.push([btn(t(lang, 'btn_close'), `u:close:${tk.id}`)]);
        rows.push([btn(t(lang, 'btn_mine'), 'u:mine:1'), btn(t(lang, 'btn_home'), 'u:menu')]);
        await render(text, kb(...rows));
        await say(`#${tk.id}`);
        return;
      }

      if (action === 'hist') {
        const tid = int(parts[2]);
        const tk = tid === null ? null : await store.getTicket(tid);
        if (!tk || tk.userId !== uid) { await say(t(lang, 'not_your_ticket'), true); return; }
        const { rows, pages, page } = await store.listMessages(tk.id, Math.max(1, int(parts[3]) ?? 1), LIMITS.HISTORY_PAGE);
        const nav = [];
        if (page > 1) nav.push(btn('◀️', `u:hist:${tk.id}:${page - 1}`));
        nav.push(btn(`${page}/${pages}`, 'u:noop'));
        if (page < pages) nav.push(btn('▶️', `u:hist:${tk.id}:${page + 1}`));
        nav.push(btn(t(lang, 'btn_back'), `u:view:${tk.id}`));
        await render(historyText(rows, lang), kb(nav));
        await say('📜');
        return;
      }

      if (action === 'close') {
        const tid = int(parts[2]);
        const tk = tid === null ? null : await store.getTicket(tid);
        if (!tk || tk.userId !== uid) { await say(t(lang, 'not_your_ticket'), true); return; }
        if (tk.status === STATUS.CLOSED) { await say(t(lang, 't_already_closed'), true); return; }
        await render(t(lang, 'close_confirm', { id: tk.id }), confirmKb(`u:closey:${tk.id}`, `u:closen:${tk.id}`, lang));
        await say('🔒');
        return;
      }

      if (action === 'closey') {
        const tid = int(parts[2]);
        const tk = tid === null ? null : await store.getTicket(tid);
        if (!tk || tk.userId !== uid) { await say(t(lang, 'not_your_ticket'), true); return; }
        if (tk.status === STATUS.CLOSED) { await say(t(lang, 't_already_closed'), true); return; }
        await closeByUser(tk, user);
        await say('🔒');
        await render(t(lang, 'u_closed_done', { id: tk.id, btn_new: t(lang, 'btn_new') }),
          kb([
            [btn(t(lang, 'btn_new'), 'u:new')],
            [btn(t(lang, 'btn_mine'), 'u:mine:1')],
          ]));
        return;
      }

      await answerCb(cb.id);
      return;
    }

    // ================= STAFF SIDE =================
    if (ns === 'a') {
      if (!staff) { await deny(); return; }
      const action = parts[1];
      const ownerFlag = await store.isOwner(uid);
      const needOwner = () => { if (!ownerFlag) deny(); return ownerFlag; };

      const renderPanel = async () => {
        const ts = await store.ticketStats();
        const us = await store.userStats();
        const counts = { open: ts.open, answered: ts.answered, all: ts.all, closed: ts.closed, users: us.total };
        await render(staffPanelText(lang, counts), staffPanelKb(lang, counts, ownerFlag));
      };

      const renderTicket = async (tid) => {
        const tk = await store.getTicket(tid);
        if (!tk) { await render(t(lang, 'ticket_gone')); return null; }
        await render(await staffTicketCard(tk, lang), staffTicketKb(tk, lang, ownerFlag));
        // If staff is mid-reply, retarget the pending reply to the ticket they are
        // currently looking at (avoids replying to the wrong ticket).
        const st = await store.getState(chatId);
        if (st?.flow === 'a_reply' && Number(st.data?.tid) !== tk.id && tk.status !== STATUS.CLOSED) {
          await store.setState(chatId, 'a_reply', { tid: tk.id });
        }
        return tk;
      };

      const renderUser = async (targetId) => {
        const target = await store.getUser(targetId);
        if (!target) { await say(t(lang, 'user_not_found'), true); return null; }
        await render(await staffUserCard(target, lang), staffUserKb(lang, target, !!target.isBanned));
        return target;
      };

      const renderStaffList = async (f, page) => {
        const filter = f === 'all' ? {} : { status: f };
        const { rows, total } = await store.listTickets(filter, page, LIMITS.LIST_PAGE);
        const pages = Math.max(1, Math.ceil(total / LIMITS.LIST_PAGE));
        const p = Math.min(Math.max(1, page), pages);
        const kbRows = [];
        for (const tk of rows) {
          const lm = await store.lastMessageOf(tk.id);
          kbRows.push([ticketItemBtn(tk, previewOf(lm, lang, 26), tk.status)]);
        }
        if (!rows.length) kbRows.push([{ text: t(lang, 'empty'), callback_data: 'a:panel' }]);
        const nav = [];
        if (p > 1) nav.push(btn('◀️', `a:list:${f}:${p - 1}`));
        nav.push(btn(t(lang, 'btn_panel'), 'a:panel'));
        if (p < pages) nav.push(btn('▶️', `a:list:${f}:${p + 1}`));
        kbRows.push(nav);
        const key = f === 'open' ? 'list_open' : f === 'answered' ? 'list_ans' : f === 'closed' ? 'list_closed' : 'list_all';
        await render(t(lang, key, { page: p, pages }), kb(...kbRows));
      };

      const renderUserTickets = async (targetId, page) => {
        const target = await store.getUser(targetId);
        if (!target) { await say(t(lang, 'user_not_found'), true); return; }
        const { rows, total } = await store.listTickets({ userId: targetId }, page, LIMITS.LIST_PAGE);
        const pages = Math.max(1, Math.ceil(total / LIMITS.LIST_PAGE));
        const p = Math.min(Math.max(1, page), pages);
        const kbRows = [];
        for (const tk of rows) {
          const lm = await store.lastMessageOf(tk.id);
          kbRows.push([ticketItemBtn(tk, previewOf(lm, lang, 26), tk.status)]);
        }
        if (!rows.length) kbRows.push([{ text: t(lang, 'empty'), callback_data: `a:user:${targetId}` }]);
        const nav = [];
        if (p > 1) nav.push(btn('◀️', `a:ulist:${targetId}:${p - 1}`));
        nav.push(btn(t(lang, 'btn_back'), `a:user:${targetId}`));
        if (p < pages) nav.push(btn('▶️', `a:ulist:${targetId}:${p + 1}`));
        kbRows.push(nav);
        await render(t(lang, 'u_list_title', { name: esc(fullName(target)), page: p, pages }), kb(...kbRows));
      };

      const renderCats = async () => {
        const enabled = await store.catsEnabled();
        const cats = await store.listCategories(false);
        const rows = cats.map((c) => ([
          btn(`${c.isEnabled ? '✅' : '❌'} ${esc((lang === 'en' ? c.titleEn : c.titleFa).slice(0, 18))}`, `a:caten:${c.id}`),
          btn(t(lang, 'btn_cat_del'), `a:catdel:${c.id}`),
        ]));
        rows.push([btn(t(lang, 'btn_cats_toggle'), 'a:catstgl')]);
        rows.push([btn(t(lang, 'btn_add_cat'), 'a:catadd')]);
        rows.push([btn(t(lang, 'btn_panel'), 'a:panel')]);
        await render(t(lang, 'cats_title', {
          state: t(lang, enabled ? 'cats_on' : 'cats_off'),
          state_hint: t(lang, enabled ? 'state_hint_on' : 'state_hint_off'),
        }), kb(...rows));
      };

      const renderAdmins = async () => {
        const rows = await store.getAdminRows();
        const kbRows = [];
        for (const a of rows) {
          const u = await store.getUser(a.tgId);
          kbRows.push([{ text: `👤 ${esc(fullName(u))}`.slice(0, 40), callback_data: `a:adminv:${a.tgId}` }]);
        }
        if (!rows.length) kbRows.push([{ text: t(lang, 'empty'), callback_data: 'a:panel' }]);
        kbRows.push([btn(t(lang, 'btn_add_admin'), 'a:adminadd')]);
        kbRows.push([btn(t(lang, 'btn_panel'), 'a:panel')]);
        await render(t(lang, 'admins_title', { n: rows.length }), kb(...kbRows));
      };

      switch (action) {
        case 'lang': {
          const l = lang === 'en' ? 'fa' : 'en';
          await store.setLang(uid, l);
          await say(t(l, 'lang_changed'));
          const ts = await store.ticketStats();
          const us = await store.userStats();
          const counts = { open: ts.open, answered: ts.answered, all: ts.all, closed: ts.closed, users: us.total };
          await render(staffPanelText(l, counts), staffPanelKb(l, counts, ownerFlag));
          return;
        }
        case 'panel': {
          await store.clearState(chatId);
          await renderPanel();
          await say('🛠');
          return;
        }
        case 'noop': { await say('·'); return; }
        case 'list': {
          const f = ['open', 'answered', 'all', 'closed'].includes(parts[2]) ? parts[2] : 'all';
          await renderStaffList(f, Math.max(1, int(parts[3]) ?? 1));
          await say('🗂');
          return;
        }
        case 'view': case 'refresh': {
          const tid = int(parts[2]);
          if (tid === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          const tk = await renderTicket(tid);
          if (tk) await say(`#${tk.id}`);
          else await say(t(lang, 'ticket_gone'), true);
          return;
        }
        case 'hist': {
          const tid = int(parts[2]);
          const tk = tid === null ? null : await store.getTicket(tid);
          if (!tk) { await say(t(lang, 'ticket_gone'), true); return; }
          const { rows, pages, page } = await store.listMessages(tk.id, Math.max(1, int(parts[3]) ?? 1), LIMITS.HISTORY_PAGE);
          const nav = [];
          if (page > 1) nav.push(btn('◀️', `a:hist:${tk.id}:${page - 1}`));
          nav.push(btn(`${page}/${pages}`, 'a:noop'));
          if (page < pages) nav.push(btn('▶️', `a:hist:${tk.id}:${page + 1}`));
          nav.push(btn(t(lang, 'btn_back'), `a:view:${tk.id}`));
          await render(historyText(rows, lang), kb(nav));
          await say('📜');
          return;
        }
        case 'reply': {
          const tid = int(parts[2]);
          const tk = tid === null ? null : await store.getTicket(tid);
          if (!tk) { await say(t(lang, 'ticket_gone'), true); return; }
          if (tk.status === STATUS.CLOSED) { await say(t(lang, 't_already_closed'), true); return; }
          await store.setState(chatId, 'a_reply', { tid: tk.id });
          await sendText(chatId, t(lang, 'reply_prompt', { id: tk.id }), kb([btn(t(lang, 'btn_back'), `a:view:${tk.id}`)]));
          await say('✍️');
          return;
        }
        case 'close': {
          const tid = int(parts[2]);
          const tk = tid === null ? null : await store.getTicket(tid);
          if (!tk) { await say(t(lang, 'ticket_gone'), true); return; }
          if (tk.status === STATUS.CLOSED) { await say(t(lang, 't_already_closed'), true); return; }
          await render(t(lang, 'close_confirm', { id: tk.id }), confirmKb(`a:closey:${tk.id}`, `a:closen:${tk.id}`, lang));
          await say('🔒');
          return;
        }
        case 'closey': {
          const tid = int(parts[2]);
          const tk = tid === null ? null : await store.getTicket(tid);
          if (!tk) { await say(t(lang, 'ticket_gone'), true); return; }
          if (tk.status === STATUS.CLOSED) { await say(t(lang, 't_already_closed'), true); await renderTicket(tid); return; }
          await closeByStaff(tk, user);
          await say('🔒');
          await renderTicket(tid);
          return;
        }
        case 'closen': {
          const tid = int(parts[2]);
          if (tid === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          await renderTicket(tid);
          await say('✖️');
          return;
        }
        case 'reopen': {
          const tid = int(parts[2]);
          const tk = tid === null ? null : await store.getTicket(tid);
          if (!tk) { await say(t(lang, 'ticket_gone'), true); return; }
          if (tk.status !== STATUS.CLOSED) { await say(t(lang, 'err_generic'), true); await renderTicket(tid); return; }
          await reopenTicket(tk, user);
          await say('🔓');
          await renderTicket(tid);
          return;
        }
        case 'del': {
          if (!needOwner()) return;
          const tid = int(parts[2]);
          const tk = tid === null ? null : await store.getTicket(tid);
          if (!tk) { await say(t(lang, 'ticket_gone'), true); return; }
          await render(t(lang, 'del_confirm', { id: tk.id }), confirmKb(`a:dely:${tk.id}`, `a:deln:${tk.id}`, lang));
          await say('🗑');
          return;
        }
        case 'dely': {
          if (!needOwner()) return;
          const tid = int(parts[2]);
          const tk = tid === null ? null : await store.getTicket(tid);
          if (!tk) { await say(t(lang, 'ticket_gone'), true); return; }
          await deleteTicketFully(tk, lang);
          await say(t(lang, 'del_done', { id: tk.id }), true);
          await render(t(lang, 'del_done', { id: tk.id }),
            kb([btn(t(lang, 'btn_panel'), 'a:panel')]));
          return;
        }
        case 'deln': {
          const tid = int(parts[2]);
          if (tid === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          await renderTicket(tid);
          await say('✖️');
          return;
        }
        case 'user': {
          const targetId = int(parts[2]);
          if (targetId === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          await store.clearState(chatId);
          const target = await renderUser(targetId);
          if (target) await say('👤');
          return;
        }
        case 'ban': {
          const targetId = int(parts[2]);
          const target = targetId === null ? null : await store.getUser(targetId);
          if (!target) { await say(t(lang, 'user_not_found'), true); return; }
          if (await store.isStaff(targetId)) { await say(t(lang, 'no_ban_staff'), true); return; }
          await render(t(lang, 'ban_confirm', { name: esc(fullName(target)) }), confirmKb(`a:bany:${targetId}`, `a:banx:${targetId}`, lang));
          await say('🚫');
          return;
        }
        case 'bany': {
          const targetId = int(parts[2]);
          const target = targetId === null ? null : await store.getUser(targetId);
          if (!target) { await say(t(lang, 'user_not_found'), true); return; }
          if (await store.isStaff(targetId)) { await say(t(lang, 'no_ban_staff'), true); return; }
          await store.setUserField(targetId, { isBanned: true });
          await say(t(lang, 'ban_done'));
          await renderUser(targetId);
          return;
        }
        case 'banx': {
          const targetId = int(parts[2]);
          if (targetId === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          await renderUser(targetId);
          await say('✖️');
          return;
        }
        case 'unban': {
          const targetId = int(parts[2]);
          const target = targetId === null ? null : await store.getUser(targetId);
          if (!target) { await say(t(lang, 'user_not_found'), true); return; }
          await store.setUserField(targetId, { isBanned: false });
          await say(t(lang, 'unban_done'));
          await renderUser(targetId);
          return;
        }
        case 'ulist': {
          const targetId = int(parts[2]);
          if (targetId === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          await renderUserTickets(targetId, Math.max(1, int(parts[3]) ?? 1));
          await say('📂');
          return;
        }
        case 'search': case 'search2': {
          await store.setState(chatId, 'a_search', {});
          await sendText(chatId, t(lang, 'search_prompt'));
          await say('🔍');
          return;
        }
        case 'openid': {
          await store.setState(chatId, 'a_open_id', {});
          await sendText(chatId, t(lang, 'open_id_prompt'));
          await say('🆔');
          return;
        }
        case 'openun': {
          await store.setState(chatId, 'a_open_un', {});
          await sendText(chatId, t(lang, 'open_un_prompt'));
          await say('🔤');
          return;
        }
        case 'msg': {
          const targetId = int(parts[2]);
          const target = targetId === null ? null : await store.getUser(targetId);
          if (!target) { await say(t(lang, 'user_not_found'), true); return; }
          if (target.isBanned) { await say(t(lang, 'target_banned'), true); return; }
          if (target.blockedBot) { await say(t(lang, 'target_blocked'), true); return; }
          await store.setState(chatId, 'a_open_msg', { uid: targetId });
          await sendText(chatId, t(lang, 'open_msg_prompt', { name: esc(fullName(target)) }));
          await say('✍️');
          return;
        }
        case 'stats': {
          const ts = await store.ticketStats();
          const us = await store.userStats();
          const enabled = await store.catsEnabled();
          await render(t(lang, 'stats_text', {
            users: us.total, banned: us.banned, all: ts.all, open: ts.open,
            ans: ts.answered, closed: ts.closed, msgs: ts.msgs,
            admins: us.adminsN, cats: us.catsN,
            catsState: t(lang, enabled ? 'cats_on' : 'cats_off'),
          }), kb([btn(t(lang, 'btn_panel'), 'a:panel')]));
          await say('📊');
          return;
        }
        case 'admins': {
          if (!needOwner()) return;
          await renderAdmins();
          await say('👥');
          return;
        }
        case 'adminadd': {
          if (!needOwner()) return;
          await store.setState(chatId, 'a_admin_add', {});
          await sendText(chatId, t(lang, 'add_admin_prompt'));
          await say('➕');
          return;
        }
        case 'adminv': {
          if (!needOwner()) return;
          const targetId = int(parts[2]);
          const target = targetId === null ? null : await store.getUser(targetId);
          const row = targetId === null ? null : (await store.getAdminRows()).find((a) => a.tgId === targetId);
          if (!row) { await say(t(lang, 'no_result'), true); return; }
          const info = target ? await staffUserCard(target, lang) : `${t(lang, 'unknown')} <code>${targetId}</code>`;
          await render(info, kb([
            [btn(t(lang, 'btn_admin_del'), `a:admindel:${targetId}`)],
            [btn(t(lang, 'btn_back'), 'a:admins'), btn(t(lang, 'btn_panel'), 'a:panel')],
          ]));
          await say('👤');
          return;
        }
        case 'admindel': {
          if (!needOwner()) return;
          const targetId = int(parts[2]);
          if (targetId === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          const target = await store.getUser(targetId);
          await render(t(lang, 'admin_del_confirm', { name: esc(target ? fullName(target) : `#${targetId}`) }),
            confirmKb(`a:admindely:${targetId}`, `a:adminv:${targetId}`, lang));
          await say('🗑');
          return;
        }
        case 'admindely': {
          if (!needOwner()) return;
          const targetId = int(parts[2]);
          if (targetId === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          await store.removeAdmin(targetId);
          await say(t(lang, 'admin_removed'));
          await renderAdmins();
          return;
        }
        case 'cats': {
          if (!needOwner()) return;
          await renderCats();
          await say('🏷');
          return;
        }
        case 'catstgl': {
          if (!needOwner()) return;
          const cur = await store.catsEnabled();
          await store.setSetting('cats_enabled', !cur);
          await say(!cur ? t(lang, 'cats_on') : t(lang, 'cats_off'));
          await renderCats();
          return;
        }
        case 'catadd': {
          if (!needOwner()) return;
          await store.setState(chatId, 'a_cat_fa', {});
          await sendText(chatId, t(lang, 'cat_fa_prompt'));
          await say('➕');
          return;
        }
        case 'caten': {
          if (!needOwner()) return;
          const cid = int(parts[2]);
          if (cid === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          const now = await store.toggleCategory(cid);
          await say(now ? t(lang, 'cats_on') : t(lang, 'cats_off'));
          await renderCats();
          return;
        }
        case 'catdel': {
          if (!needOwner()) return;
          const cid = int(parts[2]);
          const cat = cid === null ? null : await store.getCategory(cid);
          if (!cat) { await say(t(lang, 'no_result'), true); return; }
          await render(t(lang, 'cat_del_confirm', { t: esc(lang === 'en' ? cat.titleEn : cat.titleFa) }),
            confirmKb(`a:catdely:${cid}`, 'a:cats', lang));
          await say('🗑');
          return;
        }
        case 'catdely': {
          if (!needOwner()) return;
          const cid = int(parts[2]);
          if (cid === null) { await say(t(lang, 'invalid_id_num'), true); return; }
          await store.deleteCategory(cid);
          await say(t(lang, 'cat_deleted'));
          await renderCats();
          return;
        }
        default: {
          await answerCb(cb.id);
          return;
        }
      }
    }

    await answerCb(cb.id);
  } catch (e) {
    console.error('callback handler failed:', e);
    try { await answerCb(cb?.id); } catch { /* ignore */ }
  }
}
