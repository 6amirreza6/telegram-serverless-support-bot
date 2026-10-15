// ============================================================
// schema.js — Telegram Serverless database schema
// Support-ticket bot: users, admins, categories, tickets,
// ticket messages, per-chat state machine, key/value settings.
//
// NOTE (platform rule): foreign keys are NOT supported.
// Referential integrity is enforced in lib/store.js.
// ============================================================
import { table, integer, text, boolean, json, index, sql } from 'sdk/db';

// Everyone who ever talked to the bot (users AND staff).
export const users = table('users', {
  tgId:       integer('tg_id').primaryKey(),
  username:   text('username'),
  firstName:  text('first_name'),
  lastName:   text('last_name'),
  lang:       text('lang'),                                        // 'fa' | 'en' | null = not chosen yet
  isBanned:   boolean('is_banned').notNull().default(false),
  blockedBot: boolean('blocked_bot').notNull().default(false),     // user blocked the bot (via my_chat_member / 403)
  ticketCount: integer('ticket_count').notNull().default(0),
  created:    integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastSeen:   integer('last_seen', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  uIdx: index('idx_users_username').on(t.username),
}));

// Extra admins added by the owner from the panel.
// The owner is NOT stored here — the owner id lives in the settings table and
// is claimed once via /setup <key> (see lib/setup-key.js + lib/store.js).
export const admins = table('admins', {
  tgId:    integer('tg_id').primaryKey(),
  addedBy: integer('added_by').notNull(),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Ticket categories (managed by the owner; the whole feature can be toggled off).
export const categories = table('categories', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  titleFa:   text('title_fa').notNull(),
  titleEn:   text('title_en').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  created:   integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  enIdx: index('idx_categories_enabled').on(t.isEnabled),
}));

// Support tickets.
// status: 'open'     -> awaiting staff
//         'answered' -> staff replied, awaiting user
//         'closed'   -> closed (by staff or user)
// createdBy: 'user' | 'staff'
export const tickets = table('tickets', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  userId:    integer('user_id').notNull(),
  categoryId: integer('category_id'),
  status:    text('status').notNull().default('open'),
  createdBy: text('created_by').notNull().default('user'),
  closedBy:  integer('closed_by'),
  closedAt:  integer('closed_at', { mode: 'timestamp' }),
  msgCount:  integer('msg_count').notNull().default(0),
  created:   integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updated:   integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  userIdx:   index('idx_tickets_user').on(t.userId),
  statusIdx: index('idx_tickets_status').on(t.status),
  updatedIdx: index('idx_tickets_updated').on(t.updated),
}));

// Full chat history of every ticket (survives "delete ticket" only until deleted).
// kind: text|photo|video|voice|audio|document|video_note|sticker|animation|location|contact|poll|other
export const ticketMessages = table('ticket_messages', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  ticketId:  integer('ticket_id').notNull(),
  senderId:  integer('sender_id').notNull(),
  senderRole: text('sender_role').notNull().default('user'),   // 'user' | 'staff'
  kind:      text('kind').notNull().default('text'),
  text:      text('text'),
  fileId:    text('file_id'),
  created:   integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  tIdx: index('idx_tm_ticket').on(t.ticketId),
  sIdx: index('idx_tm_sender').on(t.senderId),
}));

// Per-chat conversation state (multi-step flows). TTL handled in lib/store.js.
// flow examples: u_new_ticket | a_reply | a_search | a_search_res | a_open_id |
//                a_open_un | a_open_msg | a_admin_add | a_cat_fa | a_cat_en | a_idle
export const states = table('states', {
  chatId:  integer('chat_id').primaryKey(),
  flow:    text('flow').notNull().default('a_idle'),
  data:    json('data'),
  updated: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Key/value settings (e.g. cats_enabled = true/false).
export const settings = table('settings', {
  key:   text('key').primaryKey(),
  value: json('value'),
});
