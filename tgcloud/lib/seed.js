// ============================================================
// lib/seed.js — one-shot deploy-time seeding (optional).
//
// If a file tgcloud/lib/seed-config.js exists (a copy of
// seed-config.example.js filled with YOUR values), running
//
//     npx tgcloud run lib/seed
//
// applies it to the bot's database:
//   • owner_id     → settings (only if no owner is set yet)
//   • admins       → admins table (upsert; never removes)
//   • categories   → categories table (only if table is empty)
//   • cats_enabled = true when at least one category was seeded
//
// Everything is idempotent — running it twice changes nothing.
// The seed file itself lives ONLY on the operator's machine and
// is git-ignored; this repo never contains anyone's personal IDs.
// ============================================================
import * as store from './store.js';

let seed = {};
try {
  ({ default: seed } = await import('./seed-config.js'));
} catch {
  // seed-config.js not present — the user simply didn't create one.
}

export default async function () {
  const line = '='.repeat(54);
  const applied = [];

  if (!seed || typeof seed !== 'object') seed = {};
  if (Object.keys(seed).length === 0) {
    console.log('No tgcloud/lib/seed-config.js found — nothing to seed.');
    console.log('');
    console.log('To pre-fill owner/admins/categories at deploy time:');
    console.log('  1. cp tgcloud/lib/seed-config.example.js tgcloud/lib/seed-config.js');
    console.log('  2. Fill in your values.');
    console.log('  3. Run this command again.');
    console.log('');
    console.log('Alternatively claim ownership in Telegram later:');
    console.log('  npx tgcloud run lib/setup-key   →   /setup KEY');
    return { ok: true, seeded: false };
  }

  // ---------- 1) owner (never overwrites an existing owner) ----------
  const owner = Number(seed.owner_id);
  const hasOwner = owner > 0 && Number.isInteger(owner);
  if (hasOwner) {
    if (await store.getOwnerId()) {
      console.log('• owner: ALREADY set — skipped (seed never overwrites).');
    } else {
      await store.setSetting('owner_id', owner);
      applied.push('owner');
      console.log('• owner: set to ' + owner);
    }
  }

  // ---------- 2) extra admins (upsert, deduped) ----------
  const adminIds = [...new Set(
    (Array.isArray(seed.admins) ? seed.admins : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0 && n !== owner),
  )];
  for (const id of adminIds) {
    await store.addAdmin(id, hasOwner ? owner : id);
    applied.push('admin ' + id);
    console.log('• admin: added ' + id);
  }

  // ---------- 3) categories (only into an empty table) ----------
  const cats = (Array.isArray(seed.categories) ? seed.categories : [])
    .map((c) => ({ fa: String(c?.fa ?? '').trim(), en: String(c?.en ?? '').trim() }))
    .filter((c) => c.fa || c.en);
  if (cats.length) {
    const existing = await store.listCategories();
    if (existing.length) {
      console.log('• categories: table not empty (' + existing.length +
        ' exist) — skipped.');
    } else {
      for (const c of cats) {
        await store.addCategory(c.fa || c.en, c.en || c.fa);
      }
      await store.setSetting('cats_enabled', true);
      applied.push(cats.length + ' categories');
      console.log('• categories: added ' + cats.length + ' — category system ON.');
    }
  }

  console.log(line);
  if (applied.length) {
    console.log('SEED COMPLETE: ' + applied.join(' | '));
  } else {
    console.log('Nothing was applied (everything was already set up).');
  }
  console.log('You can change admins/categories anytime from the bot panel.');
  console.log(line);
  return { ok: true, seeded: applied.length > 0 };
}
