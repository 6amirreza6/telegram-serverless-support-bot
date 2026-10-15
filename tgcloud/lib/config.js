// ============================================================
// lib/config.js — central configuration & constants
// ============================================================

// NOTE: there is NO hardcoded owner ID in this repository.
// The owner is claimed once at runtime with /setup <key> (key generated
// via the CLI: npx tgcloud run lib/setup-key) and stored in the bot's
// database (settings table). Nothing personal ever lives in the code.

export const LIMITS = {
  SETUP_KEY_TTL: 30 * 60,      // owner-claim key validity after generation (seconds)
  SETUP_MAX_FAILS: 5,          // wrong /setup attempts allowed per generated key
  MAX_TEXT_LEN: 3900,          // max chars per stored/sent message chunk (TG limit is 4096)
  MSGS_PER_MIN: 12,            // anti-flood: max ticket messages per user per minute
  NEW_TICKET_COOLDOWN: 60,     // seconds a user must wait between creating two tickets
  STATE_TTL: 30 * 60,          // conversation-state time-to-live (seconds)
  HISTORY_PAGE: 5,             // messages shown per history page
  LIST_PAGE: 6,                // tickets per list page
  SEARCH_RESULTS: 8,           // max user-search results shown
  PREVIEW_LEN: 120,            // last-message preview length in cards
  BTN_LABEL: 32,               // max chars for a list-button label
  RETRY_AFTER_CAP: 5,          // max seconds we busy-wait on 429 before giving up
};

export const STATUS = { OPEN: 'open', ANSWERED: 'answered', CLOSED: 'closed' };

// Timezone used when rendering dates. Default UTC+3:30 (Iran / Jalali).
// Change the offset here if your audience lives elsewhere.
export const TZ_OFFSET_MS = 3.5 * 3600 * 1000;

// Emoji per message kind (used in history rendering / headers)
export const KIND_EMOJI = {
  text: '💬', photo: '📷', video: '🎬', voice: '🎤', audio: '🎧',
  document: '📎', video_note: '📹', sticker: '🎭', animation: '🎞',
  location: '📍', contact: '👤', poll: '📊', other: '💬',
};

// Extract { kind, text, fileId } from any incoming Bot API message.
// fileId lets us re-send the media later; copyMessage() is used for live relay.
export function extractContent(m) {
  if (!m) return { kind: 'other', text: null, fileId: null };
  if (m.text)    return { kind: 'text', text: m.text, fileId: null };
  if (m.photo)   return { kind: 'photo', text: m.caption ?? null, fileId: m.photo[m.photo.length - 1]?.file_id ?? null };
  if (m.video)   return { kind: 'video', text: m.caption ?? null, fileId: m.video.file_id ?? null };
  if (m.voice)   return { kind: 'voice', text: m.caption ?? null, fileId: m.voice.file_id ?? null };
  if (m.audio)   return { kind: 'audio', text: m.caption ?? null, fileId: m.audio.file_id ?? null };
  if (m.video_note) return { kind: 'video_note', text: m.caption ?? null, fileId: m.video_note.file_id ?? null };
  if (m.document)   return { kind: 'document', text: m.caption ?? null, fileId: m.document.file_id ?? null };
  if (m.sticker)    return { kind: 'sticker', text: null, fileId: m.sticker.file_id ?? null };
  if (m.animation)  return { kind: 'animation', text: m.caption ?? null, fileId: m.animation.file_id ?? null };
  if (m.location)   return { kind: 'location', text: `${m.location.latitude}, ${m.location.longitude}`, fileId: null };
  if (m.contact)    return { kind: 'contact', text: [m.contact.first_name, m.contact.last_name, m.contact.phone_number].filter(Boolean).join(' '), fileId: null };
  if (m.poll)       return { kind: 'poll', text: m.poll.question ?? null, fileId: null };
  if (m.venue)      return { kind: 'location', text: m.venue.title ?? null, fileId: null };
  return { kind: 'other', text: m.caption ?? null, fileId: null };
}
