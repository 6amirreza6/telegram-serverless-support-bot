// ============================================================
// handlers/my_chat_member.js — tracks when a user blocks or
// unblocks the bot, so staff always know who is reachable.
// ============================================================
import * as store from '../lib/store.js';
import { t } from '../lib/i18n.js';
import { esc, fullName } from '../lib/ui.js';
import { notifyStaffLocalized } from '../lib/flow.js';

export default async function (mcm) {
  try {
    if (!mcm?.chat || mcm.chat.type !== 'private') return;
    const oldStatus = mcm.old_chat_member?.status;
    const newStatus = mcm.new_chat_member?.status;
    if (oldStatus === newStatus) return;

    const uid = mcm.from?.id;
    if (!uid) return;

    // Make sure we know this user (they might block before ever messaging).
    let user = await store.getUser(uid);
    if (!user && mcm.from) {
      await store.upsertUser(mcm.from);
      user = await store.getUser(uid);
    }
    const name = user ? esc(fullName(user)) : `#${uid}`;
    const tag = `🆔 <code>${uid}</code>`;

    if (newStatus === 'kicked') {
      await store.setUserField(uid, { blockedBot: true });
      await notifyStaffLocalized((l) => ({
        text: `${t(l, 'bot_blocked_by')}\n👤 ${name} | ${tag}`,
      }));
    } else if (newStatus === 'member' && oldStatus === 'kicked') {
      await store.setUserField(uid, { blockedBot: false });
      await notifyStaffLocalized((l) => ({
        text: `${t(l, 'bot_unblocked_by')}\n👤 ${name} | ${tag}`,
      }));
    }
  } catch (e) {
    console.error('my_chat_member handler failed:', e);
  }
}
