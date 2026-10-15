// ============================================================
// lib/ui.js — pure formatting & keyboard builders (no api/db)
// ============================================================
import { LIMITS, STATUS, KIND_EMOJI, TZ_OFFSET_MS } from './config.js';
import { t } from './i18n.js';

// ---------- text helpers ----------

// Escape for HTML parse_mode
export function esc(s) {
  return String(s ?? '')
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;');
}

// Jalali conversion (classic jdf algorithm; accurate for 1178–1633 AP).
function toJalali(gy, gm, gd) {
  const g_dm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) - 80 + gd + g_dm[gm - 1];
  jy += 33 * Math.floor(days / 12053); days %= 12053;
  jy += 4 * Math.floor(days / 1461); days %= 1461;
  jy += Math.floor((days - 1) / 365); if (days > 365) days = (days - 1) % 365;
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

const p2 = (n) => String(n).padStart(2, '0');

// Date (Date | unix-seconds) -> "YYYY/MM/DD HH:MM" in Tehran time.
// fa -> Jalali calendar, en -> Gregorian.
export function fmtDate(d, lang = 'fa') {
  if (!d) return '—';
  const ms = (d instanceof Date) ? d.getTime() : Number(d) * 1000;
  if (!Number.isFinite(ms)) return '—';
  const dt = new Date(ms + TZ_OFFSET_MS);
  const Y = dt.getUTCFullYear(), M = dt.getUTCMonth() + 1, D = dt.getUTCDate();
  const h = p2(dt.getUTCHours()), mi = p2(dt.getUTCMinutes());
  if (lang === 'en') return `${Y}/${p2(M)}/${p2(D)} ${h}:${mi}`;
  const j = toJalali(Y, M, D);
  return `${j.jy}/${p2(j.jm)}/${p2(j.jd)} ${h}:${mi}`;
}

export function statusInfo(status, lang) {
  if (status === STATUS.ANSWERED) return { emoji: '🟢', label: t(lang, 'st_answered') };
  if (status === STATUS.CLOSED) return { emoji: '🔒', label: t(lang, 'st_closed') };
  return { emoji: '🟡', label: t(lang, 'st_open') };
}

// Full display name (plain, unescaped — caller escapes when needed)
export function fullName(u) {
  if (!u) return '';
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (n) return n;
  if (u.username) return '@' + u.username;
  return '#' + u.tgId;
}

export function userNameBtn(u, max = LIMITS.BTN_LABEL) {
  let n = fullName(u);
  if (n.length > max) n = n.slice(0, max - 1) + '…';
  return n;
}

export function kindLabel(kind, lang) {
  const emoji = KIND_EMOJI[kind] ?? KIND_EMOJI.other;
  return { emoji, label: t(lang, 'k_' + (KIND_EMOJI[kind] ? kind : 'other')) };
}

// Split long text into <= len chunks (Telegram 4096-char safety).
export function chunkText(text, len = LIMITS.MAX_TEXT_LEN) {
  const out = [];
  let s = String(text ?? '');
  while (s.length > 0) { out.push(s.slice(0, len)); s = s.slice(len); }
  return out.length ? out : [''];
}

// ---------- keyboards ----------

export const btn = (text, data) => ({ text, callback_data: data });
export const kb = (...rows) => ({ inline_keyboard: rows });

// ---------- user side ----------

export function langPromptKb() {
  return kb([
    btn('🇮🇷 فارسی', 'u:lang:fa'),
    btn('🇬🇧 English', 'u:lang:en'),
  ]);
}

export function userMenuKb(lang, active) {
  const rows = [];
  rows.push([active
    ? btn(t(lang, 'btn_active', { id: active.id }), `u:view:${active.id}`)
    : btn(t(lang, 'btn_new'), 'u:new')]);
  rows.push([btn(t(lang, 'btn_mine'), 'u:mine:1')]);
  rows.push([btn(t(lang, 'btn_help'), 'u:help'), btn(t(lang, 'btn_lang'), 'u:langsel')]);
  return kb(...rows);
}

// One line of stored history: "1. 👤 User 💬 1404/07/23 18:30 — text…"
export function historyLine(idx, m, lang) {
  const role = m.senderRole === 'staff' ? t(lang, 'role_staff') : t(lang, 'role_user');
  const { emoji, label } = kindLabel(m.kind, lang);
  const date = fmtDate(m.created, lang);
  let body = '';
  if (m.kind === 'text' && m.text) body = m.text.length > 300 ? m.text.slice(0, 300) + '…' : m.text;
  else {
    const media = t(lang, 'fallback_media', { emoji, kind: label });
    body = m.text ? `${media} — ${m.text}` : media;
  }
  body = esc(body);
  return `${idx}. ${role} ${date}\n${body}`;
}

export function historyText(rows, lang) {
  return rows.map((m, i) => historyLine(i + 1, m, lang)).join('\n\n') || t(lang, 'empty');
}

// Short single-line preview of a stored message (for list buttons / cards).
export function previewOf(m, lang, max = 120) {
  if (!m) return '—';
  let p;
  if (m.kind === 'text' && m.text) p = m.text;
  else {
    const { emoji, label } = kindLabel(m.kind, lang);
    p = m.text ? `${emoji}[${label}] ${m.text}` : `${emoji}[${label}]`;
  }
  p = p.replace(/\s+/g, ' ').trim();
  return p.length > max ? p.slice(0, max - 1) + '…' : p;
}

export function pagerKb(prefix, page, pages, backData, backLabel) {
  const row = [];
  if (page > 1) row.push(btn('◀️', `${prefix}:${page - 1}`));
  if (page < pages) row.push(btn('▶️', `${prefix}:${page + 1}`));
  row.push(btn(backLabel ?? t('fa', 'btn_back'), backData));
  return row;
}

// ---------- staff side ----------

export function staffPanelKb(lang, counts, isOwnerFlag) {
  const rows = [
    [
      btn(t(lang, 'btn_open_n', { n: counts.open }), 'a:list:open:1'),
      btn(t(lang, 'btn_ans_n', { n: counts.answered }), 'a:list:answered:1'),
    ],
    [
      btn(t(lang, 'btn_all_n', { n: counts.all }), 'a:list:all:1'),
      btn(t(lang, 'btn_closed_n', { n: counts.closed }), 'a:list:closed:1'),
    ],
    [btn(t(lang, 'btn_search'), 'a:search'), btn(t(lang, 'btn_stats'), 'a:stats')],
    [btn(t(lang, 'btn_open_id'), 'a:openid'), btn(t(lang, 'btn_open_un'), 'a:openun')],
  ];
  if (isOwnerFlag) {
    rows.push([btn(t(lang, 'btn_admins'), 'a:admins'), btn(t(lang, 'btn_cats'), 'a:cats')]);
  }
  rows.push([btn(t(lang, 'lang_toggle'), 'a:lang')]);
  return kb(...rows);
}

export function staffPanelText(lang, counts) {
  return t(lang, 'panel_title', counts);
}

// Compact ticket button label for lists: "#12 🟡 Ali: text…"
export function ticketItemBtn(ticket, preview, status) {
  const emoji = statusInfo(status, 'fa').emoji;
  let p = (preview ?? '').replace(/\s+/g, ' ').trim();
  if (p.length > 26) p = p.slice(0, 26) + '…';
  return btn(`#${ticket.id} ${emoji} ${p}`, `a:view:${ticket.id}`);
}

export function staffTicketKb(ticket, lang, isOwnerFlag) {
  const rows = [];
  if (ticket.status !== STATUS.CLOSED) {
    rows.push([btn(t(lang, 'btn_reply'), `a:reply:${ticket.id}`)]);
    rows.push([
      btn(t(lang, 'btn_close'), `a:close:${ticket.id}`),
      btn(t(lang, 'btn_refresh'), `a:view:${ticket.id}`),
    ]);
  } else {
    rows.push([btn(t(lang, 'btn_reopen'), `a:reopen:${ticket.id}`)]);
  }
  rows.push([
    btn(t(lang, 'btn_user'), `a:user:${ticket.userId}`),
    btn(t(lang, 'btn_history'), `a:hist:${ticket.id}:1`),
  ]);
  if (isOwnerFlag) rows.push([btn(t(lang, 'btn_del'), `a:del:${ticket.id}`)]);
  rows.push([btn(t(lang, 'btn_panel'), 'a:panel')]);
  return kb(...rows);
}

export function staffUserKb(lang, u, isBanned) {
  const rows = [
    [btn(t(lang, 'btn_msg_user'), `a:msg:${u.tgId}`)],
    [btn(t(lang, 'btn_u_tickets'), `a:ulist:${u.tgId}:1`)],
    [isBanned ? btn(t(lang, 'btn_unban'), `a:unban:${u.tgId}`) : btn(t(lang, 'btn_ban'), `a:ban:${u.tgId}`)],
    [btn(t(lang, 'btn_panel'), 'a:panel')],
  ];
  return kb(...rows);
}

export function confirmKb(yesData, noData, lang) {
  return kb([
    btn(t(lang, 'btn_yes'), yesData),
    btn(t(lang, 'btn_no'), noData),
  ]);
}

