// ============================================================
// lib/setup-key.js — one-time owner-claim key generator.
//
// This module exists so the person deploying the bot can claim
// ownership WITHOUT hardcoding any personal ID in the repository.
//
// Usage (from your project folder, after `npx tgcloud login`):
//
//     npx tgcloud run lib/setup-key
//
// The key is stored ONLY in the bot's database (settings table)
// and printed ONLY to YOUR terminal. Then, within 30 minutes,
// send this to your bot from your own Telegram account:
//
//     /setup <the key>
//
// The first account to present a valid key becomes the owner.
// If an owner already exists, a valid key TRANSFERS ownership.
// Generating a new key invalidates the previous one and resets
// the wrong-attempt counter. The key is single-use.
// ============================================================
import * as store from './store.js';

// No look-alike characters (0/O, 1/I/L removed) for easy mobile typing.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomKey(len = 8) {
  let out = '';
  // Prefer Web Crypto when available, fall back to Math.random.
  const cryptoObj = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? crypto : null;
  const bytes = new Uint32Array(len);
  if (cryptoObj) cryptoObj.getRandomValues(bytes);
  for (let i = 0; i < len; i++) {
    const r = cryptoObj ? bytes[i] : Math.floor(Math.random() * 0x100000000);
    out += ALPHABET[r % ALPHABET.length];
  }
  return out;
}

export default async function () {
  const key = randomKey();
  await store.setSetupKey(key);

  const currentOwner = await store.getOwnerId();
  const line = '='.repeat(54);
  console.log(line);
  console.log('Owner-claim key generated (valid for 30 minutes).');
  console.log('');
  console.log('   /setup ' + key);
  console.log('');
  console.log('Send the command above to your bot in Telegram,');
  console.log('from the account that must become the OWNER.');
  console.log(line);
  if (currentOwner) {
    console.log('NOTE: an owner is ALREADY set (id ' + currentOwner + ').');
    console.log('A successful claim with this key will TRANSFER');
    console.log('ownership to the claiming account.');
  } else {
    console.log('No owner is set yet — the first valid claim wins.');
  }
  return { ok: true, ttlMinutes: 30 };
}
