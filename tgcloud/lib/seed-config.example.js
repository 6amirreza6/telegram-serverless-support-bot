// ============================================================
// lib/seed-config.example.js — template for deploy-time seeding.
//
// HOW TO USE (your real copy is NEVER committed anywhere):
//   1. cp tgcloud/lib/seed-config.example.js tgcloud/lib/seed-config.js
//   2. Fill in YOUR values below (every field is optional).
//   3. After `npx tgcloud push` + `npx tgcloud migrate`, run:
//        npx tgcloud run lib/seed
//
// seed-config.js is git-ignored, so personal IDs stay on YOUR
// machine and are only pushed to the bot's own database.
//
// Prefer not to put your owner ID here? Use the secure claim
// flow instead: npx tgcloud run lib/setup-key  →  /setup KEY
// ============================================================

export default {
  // Numeric Telegram ID of the bot OWNER. 0 / omitted = skip
  // (the owner can always be claimed later via /setup <key>).
  owner_id: 0,

  // Extra admin Telegram IDs (NOT the owner). Upserted one by one;
  // existing admins are never removed by seeding.
  admins: [
    // 123456789,
    // 987654321,
  ],

  // Ticket categories — both titles are required; an empty side
  // mirrors the other. Seeded only when the table is still empty,
  // and the category system is switched ON automatically.
  categories: [
    // { fa: 'پشتیبانی فنی', en: 'Technical' },
    // { fa: 'فروش و سفارشات', en: 'Sales & Orders' },
    // { fa: 'پیشنهادات', en: 'Suggestions' },
  ],
};
