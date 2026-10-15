# AGENTS.md — orientation for AI coding assistants

A support-ticket bot for [Telegram Serverless](https://core.telegram.org/bots/serverless).
It runs entirely on Telegram's infrastructure — there is no server to host and
no npm runtime dependencies. After scaffolding a project with
`npm create @tgcloud/bot`, the full SDK reference is available at
`docs/tgcloud-sdk.md` (created by the CLI) — read it before changing code.

## Hard rules of the platform

- One handler per update type, flat under `tgcloud/handlers/`
  (`message.js`, `callback_query.js`, `my_chat_member.js`).
- Modules import each other by **relative path with the `.js` extension**
  (`'../lib/store.js'`); platform SDK is imported as `'sdk'` / `'sdk/db'`.
- The database is SQLite-backed via `sdk/db` (Drizzle-like). **Foreign keys
  are NOT supported** — referential integrity is enforced in `lib/store.js`.
- Every `db` call is async. Schema changes deploy in two steps:
  `npx tgcloud push` (upload) then `npx tgcloud migrate` (apply).
- Only `.js` files under `schema.js`, `lib/`, `handlers/`, `endpoints/`
  are deployed. `callback_data` is limited to 64 bytes.

## Project layout

```
tgcloud/
├─ schema.js            # 7 tables: users, admins, categories, tickets,
│                       #   ticket_messages, states, settings
├─ lib/
│  ├─ config.js         # limits, statuses, media extraction (NO personal data)
│  ├─ store.js          # every db query; owner lives in `settings` table
│  ├─ i18n.js           # all fa/en strings
│  ├─ ui.js             # keyboards, cards, Jalali date formatting
│  ├─ flow.js           # Bot API delivery: 403/429 handling, staff fan-out
│  └─ setup-key.js      # CLI-run module: prints a one-time /setup key
└─ handlers/
   ├─ message.js        # router: users vs staff, state machine, /commands
   ├─ callback_query.js # every inline button (u:* / a:* namespaces)
   └─ my_chat_member.js # bot blocked / unblocked tracking
```

## Conventions specific to this bot

- **No personal data in the repo.** The owner ID is claimed at runtime via
  `/setup <key>` and stored in the `settings` table. Never hardcode a user
  ID, bot token, or CLI access token anywhere.
- Bilingual by design: every user-facing string goes through
  `t(lang, key, vars)` in `lib/i18n.js` — add new strings to BOTH the `FA`
  and `EN` dictionaries.
- Every message to a user goes through `lib/flow.js` helpers
  (`sendText`, `copyTo`, `editOrSend`) so 403/429/blocked-bot states are
  handled uniformly and staff receive localized copies.
- Staff fan-out (`store.getStaffIds()`) is owner-first, then admins, deduped.
- Each user has at most one active ticket; new-ticket races merge into it.

## Testing a change without deploying

```bash
npx tgcloud run handlers/message '{ chat: { id: 1 }, from: { id: 1 }, text: "/start" }'
```

Deploy with `npx tgcloud push`, then `npx tgcloud migrate` if `schema.js`
changed.
