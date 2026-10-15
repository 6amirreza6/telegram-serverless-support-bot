# Telegram Serverless Support Bot

A complete customer-support ticket bot that runs **entirely on Telegram's own infrastructure** — no server, no hosting bill, no VPS to maintain. Users open tickets in a private chat; your support team replies from the same chat using a full management panel. Nothing in this repository is tied to any person: you deploy it, claim ownership with a one-time key, and go live in about five minutes.

**English** | [فارسی](README.fa.md)

## Features

- **Real two-way conversations** — after a user opens a ticket, *every* message they send (text, photo, video, voice, audio, file, round video, sticker, GIF, location, contact, poll) is automatically attached to their active ticket and relayed live to the support team.
- **Full staff panel** — open/answered/closed ticket lists with live counters, inline ticket cards with the last-message preview, paginated chat history, reply / close / reopen actions.
- **Outbound tickets** — start a conversation with any user by numeric ID or @username (the ticket appears in their chat as if support wrote first).
- **User search** — find users by numeric ID, @username fragment or name fragment.
- **Owner + admins** — the owner (you) can add or remove admins from the panel. Only the owner can *fully delete* a ticket (every stored message included, with a double confirmation) and manage categories.
- **Ticket categories** (optional) — owner-defined, bilingual category lists with a global on/off switch.
- **Anti-abuse** — per-user ban list with silent dropping, flood limit (messages/minute), cooldown between tickets, state TTL, brute-force guard on the ownership claim.
- **Bilingual UI** — Persian and English, chosen by each user; every staff member receives notifications **in their own language**. Persian dates are rendered in the Jalali calendar.
- **Resilient delivery** — blocked-bot (403) detection and flagging, `chat not found` handling, HTTP 429 rate-limit with a single smart retry.
- **Zero infrastructure** — code and SQLite-backed database live on Telegram Serverless; deploys are atomic (`push`) and schema changes are explicit (`migrate`).

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- A Telegram bot registered with [@BotFather](https://t.me/BotFather) with **Serverless enabled**: open your bot → `Serverless` → turn it on.

## ⚡ Web installer (easiest way)

Not comfortable with the terminal? The **[web installer](https://6amirreza6.github.io/telegram-serverless-support-bot/)** does everything in your browser:

1. It walks you through getting the **CLI ACCESS** token from BotFather and collects your settings (owner & admin IDs, bilingual categories, default language, anti-abuse limits) right on the page — **nothing is ever sent to any server**.
2. It builds a complete project from this repo's source — including your personal `seed-config.js` — and downloads it as a zip.
3. All that remains is 5 CLI commands: `npm install` → `npx tgcloud login` → `push` → `migrate` → `npx tgcloud run lib/seed`.

The installer's source lives in this repo under [`docs/`](docs/) — audit it before you use it.

## Quick start (CLI Access)

Everything below happens in your terminal. The bot's CLI access token **never leaves your machine** — the CLI stores it in `.tgcloud/`, which is git-ignored.

```bash
# 1) Scaffold a fresh project (creates the folder and installs the CLI)
npm create @tgcloud/bot my-support-bot
cd my-support-bot

# 2) Bring in this project's code
#    Copy the contents of this repository into the folder
#    (tgcloud/, package.json, tgcloud.jsonc — overwrite the starter files).
#    With git:
git clone https://github.com/6amirreza6/telegram-serverless-support-bot tmp-clone
cp -R tmp-clone/tgcloud tmp-clone/tgcloud.jsonc tmp-clone/package.json .
rm -rf tmp-clone

# 3) Link the project to YOUR bot (paste the CLI Access token when asked;
#    BotFather → your bot → Serverless → CLI Access)
npx tgcloud login

# 4) Deploy the code, then create the database tables
npx tgcloud push
npx tgcloud migrate
```

### First run: claim ownership (nothing personal is in the code!)

There is **no owner ID hardcoded anywhere**. Instead, you claim ownership once with a one-time key that lives only in your bot's database and your terminal:

```bash
npx tgcloud run lib/setup-key
```

The CLI prints something like:

```
   /setup AB2C9DEF
```

Send that command to your bot **from your own Telegram account** within 30 minutes. That account becomes the owner, the key is destroyed, and the management panel opens. From there use `👥 Admins` in the panel to add your support team — they never need CLI access.

> Lost the key or want to hand the bot to someone else? Just run
> `npx tgcloud run lib/setup-key` again — a new key invalidates the old one,
> and a successful claim transfers ownership.

**Alternative: deploy-time seeding.** To register the owner, admins and categories without any Telegram round-trip, copy `tgcloud/lib/seed-config.example.js` to `seed-config.js` (git-ignored), fill in your values and run `npx tgcloud run lib/seed` after `migrate`. The web installer does this automatically.

## Daily commands (CLI)

| Command | What it does |
|---|---|
| `npx tgcloud status` | which files differ from the deployed copy (offline) |
| `npx tgcloud diff` | line-by-line changes |
| `npx tgcloud push` | deploy changed modules (atomic, includes deletions) |
| `npx tgcloud migrate` | review & apply pending `schema.js` changes |
| `npx tgcloud run lib/setup-key` | print a fresh one-time owner-claim key |
| `npx tgcloud run lib/seed` | one-shot load of `seed-config.js` settings (owner/admins/categories) |
| `npx tgcloud pull` / `reset` | sync local copy with the cloud / discard local changes |

In CI, export `TGCLOUD_TOKEN` instead of running `npx tgcloud login`.

Inside Telegram, staff use `/panel`, `/search`, `/open`, `/stats`, `/cancel`; users get `/start`, `/menu`, `/id`, `/lang`, `/cancel`.

## Publish your own copy to GitHub

The repository is designed to be public:

- **No IDs, tokens or usernames in the code** — the owner is resolved from the database at runtime; grep the tree and you will find nothing personal.
- `.tgcloud/` (your CLI access token), `tgcloud/lib/seed-config.js` (your personal IDs) and `node_modules/` are git-ignored.
- User data never touches git — it lives in the bot's serverless database.

```bash
git init
git add .
git commit -m "Telegram Serverless support bot"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Before pushing a fork you customized, double-check with `git grep` that you did not accidentally add any ID or token.

## Configuration

All knobs live in `tgcloud/lib/config.js`:

| Constant | Default | Meaning |
|---|---|---|
| `SETUP_KEY_TTL` | 1800 s | validity of a generated owner-claim key |
| `SETUP_MAX_FAILS` | 5 | wrong `/setup` attempts allowed per key |
| `MAX_TEXT_LEN` | 3900 | chunk size for stored messages (TG limit 4096) |
| `MSGS_PER_MIN` | 12 | anti-flood: ticket messages per user per minute |
| `NEW_TICKET_COOLDOWN` | 60 s | wait between two ticket creations |
| `STATE_TTL` | 1800 s | multi-step flow state expiry |
| `HISTORY_PAGE` / `LIST_PAGE` | 5 / 6 | pagination sizes |
| `SEARCH_RESULTS` | 8 | max user-search results |
| `TZ_OFFSET_MS` | +3:30 | timezone used for date rendering (Jalali default) |

## Architecture

```
tgcloud/
├─ schema.js              # users, admins, categories, tickets,
│                         #   ticket_messages, states, settings (no FKs —
│                         #   integrity enforced in code)
├─ lib/
│  ├─ config.js           # limits, statuses, media extraction
│  ├─ store.js            # all db queries; owner lives in settings table
│  ├─ i18n.js             # every fa/en string
│  ├─ ui.js               # keyboards, cards, Jalali dates
│  ├─ flow.js             # delivery layer: 403/429 handling, fan-out
│  ├─ setup-key.js        # CLI-run module → prints /setup key
│  ├─ seed.js             # one-shot seed-config.js loader (optional)
│  └─ seed-config.example.js  # template for personal settings (copy → seed-config.js)
└─ handlers/
   ├─ message.js          # router: users/staff, state machine, commands
   ├─ callback_query.js   # all inline buttons (u:* / a:* namespaces)
   └─ my_chat_member.js   # bot blocked/unblocked tracking
```

Platform rules worth knowing: handlers are flat files, `callback_data` is capped at 64 bytes, `push` never touches the database and `migrate` never ships code, and every module runs in an isolated V8 sandbox on Telegram's edge.

## Security model

- **Ownership** — claimed once via `/setup <key>`. Keys are 8 characters from a 32-symbol alphabet (no look-alikes), single-use, expire in 30 minutes, allow at most 5 wrong attempts, and are stored server-side only. A fresh key invalidates the previous one; a valid claim transfers ownership.
- **Data residency** — user records, tickets and messages live in *your* bot's serverless database. The repository holds none of it.
- **Ticket deletion** — owner-only, double-confirmed, and cascades to every stored message row.
- **Bans** — banned users are silently ignored (no feedback loop for spammers); staff can never be banned.

## License

[The Unlicense](LICENSE) — public domain. Copy it, fork it, sell it, make it yours. No attribution required.
