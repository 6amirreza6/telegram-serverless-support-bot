/* ============================================================
   app.js — Web Installer logic (client-only, zero backend).
   - Bilingual FA/EN UI (default: fa, RTL)
   - Collects owner/admin IDs, categories, advanced options
   - Patches embedded bot source + builds seed-config.js
   - Generates a ready-to-deploy zip entirely in the browser
   Nothing is uploaded anywhere. Ever.
   ============================================================ */
'use strict';

/* ================= i18n ================= */
const DICT = {
  fa: {
    brand_title: 'نصب‌کننده ربات پشتیبانی',
    brand_sub: 'Telegram Serverless · بدون سرور',
    nav1: 'دریافت توکن CLI', nav2: 'تنظیمات ربات', nav3: 'ساخت و دانلود پروژه', nav4: 'استقرار با CLI',
    hero_title: 'ربات پشتیبانی تلگرام را در چند دقیقه راه‌اندازی کنید',
    hero_sub: 'این صفحه اطلاعات لازم (آیدی مدیر، ادمین‌ها، دسته‌بندی‌ها و تنظیمات) را در <b>مرورگر خودتان</b> جمع می‌کند، یک پروژه آماده استقرار می‌سازد و شما آن را با <b>CLI ACCESS</b> روی سرورلس تلگرام پوش می‌کنید.',
    privacy: 'کاملاً سمت کلاینت — هیچ داده‌ای به هیچ سروری ارسال یا ذخیره نمی‌شود. همه‌چیز در مرورگر شما می‌ماند.',
    s1_title: 'دریافت توکن CLI ACCESS از BotFather',
    s1_p: 'CLI ACCESS قابلیتی است که به شما اجازه می‌دهد کد ربات را از ترمینال خودتان روی زیرساخت تلگرام مستقر کنید. توکن آن فقط از BotFather صادر می‌شود:',
    s1_l1: 'وارد ربات <b>@BotFather</b> شوید و ربات خود را انتخاب کنید (یا یک ربات جدید بسازید).',
    s1_l2: 'روی دکمه <b>Serverless</b> بزنید و آن را برای رباتتان <b>روشن</b> کنید.',
    s1_l3: 'گزینه <b>CLI Access</b> را باز کنید و توکن دسترسی CLI را کپی کنید.',
    s1_l4: 'توکن را همین‌جا نگه دارید — در مرحله ۴ هنگام اجرای <code>npx tgcloud login</code> به آن نیاز دارید.',
    s1_open_botfather: 'باز کردن BotFather در تلگرام',
    s1_token_label: 'توکن CLI ACCESS شما (اختیاری — فقط در همین صفحه)',
    s1_token_ph: 'توکن را اینجا بچسبانید تا گم نشود…',
    copy: 'کپی', copied: 'کپی شد ✓', copied_fail: 'کپی نشد — دستی کپی کنید',
    s1_token_hint: '⚠️ این توکن فقط در حافظه همین مرورگر می‌ماند؛ داخل فایل zip ساخته‌شده قرار <b>نمی‌گیرد</b> و هیچ‌جا ارسال نمی‌شود.',
    s2_title: 'تنظیمات ربات خود را وارد کنید',
    s2_p: 'همه فیلدها اختیاری‌اند. مقادیری که وارد کنید در زمان استقرار مستقیماً داخل دیتابیس ربات بارگذاری می‌شوند (Seed) — نه در GitHub و نه در هیچ جای کد.',
    f_owner: '🆔 آیدی عددی مدیر اصلی (Owner)',
    f_owner_ph: 'مثلاً 123456789',
    f_owner_hint: 'آیدی عددی خود را از @userinfobot بگیرید. اگر خالی بگذارید، بعداً با جریان امن <code>/setup</code> مالکیت را ادعا می‌کنید.',
    f_lang: '🌐 زبان پیش‌فرض ربات', lang_fa: 'فارسی', lang_en: 'English',
    f_lang_hint: 'هر کاربر می‌تواند زبان خودش را عوض کند؛ این فقط زبان شروع است.',
    f_admins: '👥 آیدی ادمین‌های دیگر (هر خط یک آیدی)',
    f_admins_ph: '123456789\n987654321',
    f_admins_hint: 'ادمین‌ها به تیکت‌ها پاسخ می‌دهند ولی نمی‌توانند ادمین اضافه کنند یا تیکت را حذف کنند.',
    f_cats: '🗂 دسته‌بندی تیکت‌ها',
    f_cats_hint: 'دو زبانه وارد کنید (فارسی + English). اگر حداقل یک دسته بدهید، سیستم دسته‌بندی خودکار فعال می‌شود.',
    add_cat: 'افزودن دسته', cat_fa_ph: 'عنوان فارسی', cat_en_ph: 'English title',
    adv_title: '⚙️ تنظیمات پیشرفته (اختیاری)',
    f_mpm: 'حد پیام در دقیقه (هر کاربر)', f_cd: 'فاصله ساخت دو تیکت (ثانیه)', f_tz: 'منطقه زمانی نمایش تاریخ',
    tz35: 'تهران (UTC+3:30)', tz40: 'دبی (UTC+4)', tz30: 'استانبول (UTC+3)', tz55: 'دهلی (UTC+5:30)',
    tz10: 'برلین (UTC+1)', tz00: 'لندن / UTC', tzm5: 'نیویورک (UTC−5)', tzm8: 'لس‌آنجلس (UTC−8)',
    s3_title: 'ساخت و دانلود پروژه آماده استقرار',
    s3_p: 'سورس کامل ربات + فایل تنظیمات شخصی شما (seed-config.js) داخل یک فایل zip ساخته می‌شود — همه‌چیز همین‌جا در مرورگر.',
    gen_btn: 'ساخت و دانلود پروژه',
    gen_missing_files: 'سورس ربات پیدا نشد (bot-files.js بارگذاری نشده). اتصال اینترنت را بررسی و صفحه را رفرش کنید.',
    gen_busy: '⏳ در حال ساخت zip…',
    gen_done: '✅ فایل آماده شد و دانلود شروع شد.',
    gen_error: 'خطا در ساخت فایل: ',
    err_bad_owner: 'آیدی مدیر اصلی باید فقط عدد باشد.',
    err_bad_admin_line: 'خط {n} ادمین‌ها معتبر نیست: «{v}» — فقط عدد مجاز است.',
    sum_title: 'محتوای فایل ساخته‌شده:',
    sum_owner_yes: 'مالک: آیدی {v} (در زمان seed ثبت می‌شود)',
    sum_owner_no: 'مالک: تعیین نشد — با /setup بعد از استقرار ادعا می‌کنید',
    sum_admins: 'ادمین‌ها: {n} آیدی',
    sum_cats: 'دسته‌بندی‌ها: {n} دسته (سیستم دسته‌بندی روشن می‌شود)',
    sum_cats_zero: 'دسته‌بندی: خالی — بعداً از پنل ربات قابل افزودن است',
    sum_lang: 'زبان پیش‌فرض: {v}',
    sum_adv: 'تنظیمات پیشرفته: پیام/دقیقه = {m}، فاصله تیکت = {c} ثانیه، منطقه زمانی = UTC{t}',
    sum_seed: 'tgcloud/lib/seed-config.js با تنظیمات شما',
    sum_files: '{n} فایل سورس ربات (آخرین نسخه مخزن)',
    s4_title: 'استقرار روی سرورلس تلگرام با CLI',
    s4_p: 'فایل zip را در یک پوشه جدید باز کنید، سپس این دستورها را به ترتیب در همان پوشه اجرا کنید (Node.js 18+ لازم است):',
    c2_note: '↳ توکن CLI Access مرحله ۱ را اینجا بچسبانید.',
    c5_note: '↳ تنظیماتی که در مرحله ۲ وارد کردید (مالک، ادمین‌ها، دسته‌ها) را داخل دیتابیس ربات بارگذاری می‌کند.',
    alt_title: 'راه جایگزین برای مالکیت (بدون نوشتن آیدی)',
    alt_p: 'اگر آیدی خود را وارد نکرده‌اید، بعد از migrate این دو مرحله را انجام دهید: اول <code>npx tgcloud run lib/setup-key</code> روی کامپیوتر، بعد ارسال <code>/setup KEY</code> به ربات در تلگرام (کلید ۳۰ دقیقه اعتبار دارد و یک‌بارمصرف است).',
    done_title: '🎉 تمام شد!',
    done_p: 'ربات خود را در تلگرام باز کنید، <code>/start</code> بزنید و با <code>/panel</code> وارد پنل مدیریت شوید. همه تنظیمات بعداً هم از داخل خود ربات قابل تغییر است.',
    sec_title: 'نکات امنیتی',
    sec1: 'توکن CLI ACCESS را با کسی تقسیم نکنید؛ هر کس توکن را داشته باشد می‌تواند کد ربات شما را عوض کند. اگر لو رفت، از BotFather آن را بازتولید کنید.',
    sec2: 'فایل zip ساخته‌شده شامل <code>tgcloud/lib/seed-config.js</code> با آیدی‌های شخصی شماست — آن را فقط روی سیستم خودتان نگه دارید و در هیچ مخزنی پابلیش نکنید (در همین پروژه gitignore شده است).',
    sec3: 'این صفحه هیچ بک‌اند، آنالیتیکس یا کوکی ندارد؛ می‌توانید قبل از استفاده سورس آن را در پوشه <code>docs/</code> مخزن بررسی کنید.',
    sec4: 'برای مالکیت، جریان <code>/setup</code> با کلید یک‌بارمصرف امن‌ترین گزینه است؛ وارد کردن آیدی در مرحله ۲ صرفاً راحت‌تر است.',
    faq_title: 'سوالات پرتکرار',
    q1: 'آیا این سایت چیزی روی GitHub یا جایی دیگر ذخیره می‌کند؟',
    a1: 'نه. صفحه فقط HTML/JS استاتیک است؛ فرم‌ها در حافظه مرورگر پردازش و فایل zip همان‌جا ساخته می‌شود. هیچ درخواستی به هیچ سروری ارسال نمی‌شود (فقط فونت و کتابخانه zip از CDN خوانده می‌شود).',
    q2: 'چرا سایت خودش مستقیماً روی سرورلس تلگرام پوش نمی‌کند؟',
    a2: 'پروتکل CLI ACCESS برای اجرا از ترمینال شما طراحی شده و از مرورگر (به‌دلیل CORS) قابل فراخوانی نیست. به همین دلیل این صفحه پروژه آماده را می‌سازد و دستورهای دقیق CLI را می‌دهد — کل استقرار با ۵ دستور انجام می‌شود.',
    q3: 'بعداً چطور تنظیمات را عوض کنم؟',
    a3: 'ادمین‌ها، دسته‌بندی‌ها، بستن/حذف تیکت و همه‌چیز از داخل پنل خود ربات قابل مدیریت است. برای تغییر محدودیت‌ها یا منطقه زمانی، فایل config.js پروژه را ویرایش و دوباره push کنید.',
    foot_left: 'پروژه‌ای مالکیت عمومی (The Unlicense) — بدون هیچ داده شخصی در مخزن.',
    foot_repo: 'سورس در GitHub ↗',
  },
  en: {
    brand_title: 'Support Bot Installer',
    brand_sub: 'Telegram Serverless · no server needed',
    nav1: 'Get CLI token', nav2: 'Bot settings', nav3: 'Build & download', nav4: 'Deploy via CLI',
    hero_title: 'Launch your Telegram support bot in minutes',
    hero_sub: 'This page collects everything needed (owner & admin IDs, categories, settings) <b>in your own browser</b>, builds a ready-to-deploy project, and you push it to Telegram Serverless with <b>CLI ACCESS</b>.',
    privacy: 'Fully client-side — nothing is sent to or stored on any server. Everything stays in your browser.',
    s1_title: 'Get your CLI ACCESS token from BotFather',
    s1_p: 'CLI ACCESS lets you deploy bot code from your own terminal onto Telegram infrastructure. The token is issued only by BotFather:',
    s1_l1: 'Open <b>@BotFather</b> and select your bot (or create a new one).',
    s1_l2: 'Tap the <b>Serverless</b> button and turn it <b>on</b> for your bot.',
    s1_l3: 'Open <b>CLI Access</b> and copy the CLI access token.',
    s1_l4: 'Keep the token at hand — you will need it in step 4 when running <code>npx tgcloud login</code>.',
    s1_open_botfather: 'Open BotFather in Telegram',
    s1_token_label: 'Your CLI ACCESS token (optional — this page only)',
    s1_token_ph: 'Paste the token here so it does not get lost…',
    copy: 'Copy', copied: 'Copied ✓', copied_fail: 'Copy failed — do it manually',
    s1_token_hint: '⚠️ The token stays in this browser only; it is <b>never</b> placed inside the generated zip and never sent anywhere.',
    s2_title: 'Configure your bot',
    s2_p: 'Every field is optional. Values you enter are loaded straight into the bot database at deploy time (Seed) — not into GitHub, not into the code.',
    f_owner: '🆔 Owner numeric Telegram ID',
    f_owner_ph: 'e.g. 123456789',
    f_owner_hint: 'Get your numeric ID from @userinfobot. Leave empty to claim ownership later via the secure <code>/setup</code> flow.',
    f_lang: '🌐 Default bot language', lang_fa: 'فارسی', lang_en: 'English',
    f_lang_hint: 'Every user can switch their own language; this is only the starting one.',
    f_admins: '👥 Other admin IDs (one per line)',
    f_admins_ph: '123456789\n987654321',
    f_admins_hint: 'Admins answer tickets but cannot add admins or delete tickets.',
    f_cats: '🗂 Ticket categories',
    f_cats_hint: 'Enter both languages (فارسی + English). Providing at least one category switches the category system on.',
    add_cat: 'Add category', cat_fa_ph: 'عنوان فارسی', cat_en_ph: 'English title',
    adv_title: '⚙️ Advanced options (optional)',
    f_mpm: 'Messages per minute (per user)', f_cd: 'Seconds between new tickets', f_tz: 'Date display timezone',
    tz35: 'Tehran (UTC+3:30)', tz40: 'Dubai (UTC+4)', tz30: 'Istanbul (UTC+3)', tz55: 'Delhi (UTC+5:30)',
    tz10: 'Berlin (UTC+1)', tz00: 'London / UTC', tzm5: 'New York (UTC−5)', tzm8: 'Los Angeles (UTC−8)',
    s3_title: 'Build & download the deploy-ready project',
    s3_p: 'The full bot source + your personal settings file (seed-config.js) are packed into one zip — entirely in your browser.',
    gen_btn: 'Build & download project',
    gen_missing_files: 'Bot source not found (bot-files.js failed to load). Check your connection and refresh.',
    gen_busy: '⏳ Building zip…',
    gen_done: '✅ File ready — download started.',
    gen_error: 'Failed to build the file: ',
    err_bad_owner: 'Owner ID must contain digits only.',
    err_bad_admin_line: 'Admins line {n} is not valid: “{v}” — digits only.',
    sum_title: 'What is inside the generated file:',
    sum_owner_yes: 'Owner: ID {v} (written during seed)',
    sum_owner_no: 'Owner: not set — claim it with /setup after deploying',
    sum_admins: 'Admins: {n} ID(s)',
    sum_cats: 'Categories: {n} (category system switched on)',
    sum_cats_zero: 'Categories: none — you can add them later from the bot panel',
    sum_lang: 'Default language: {v}',
    sum_adv: 'Advanced: {m} msgs/min, {c}s ticket cooldown, timezone UTC{t}',
    sum_seed: 'tgcloud/lib/seed-config.js with your settings',
    sum_files: '{n} bot source files (latest repo version)',
    s4_title: 'Deploy to Telegram Serverless via CLI',
    s4_p: 'Unzip the downloaded file into a new folder, then run these commands inside it (Node.js 18+ required):',
    c2_note: '↳ Paste your CLI Access token from step 1 here.',
    c5_note: '↳ Loads the settings you entered in step 2 (owner, admins, categories) into the bot database.',
    alt_title: 'Alternative ownership flow (no ID typing)',
    alt_p: 'If you left the owner ID empty, do this after migrate: run <code>npx tgcloud run lib/setup-key</code> on your computer, then send <code>/setup KEY</code> to your bot in Telegram (the key is valid for 30 minutes and single-use).',
    done_title: '🎉 Done!',
    done_p: 'Open your bot in Telegram, send <code>/start</code>, then <code>/panel</code> for the management panel. Everything can be changed later from inside the bot.',
    sec_title: 'Security notes',
    sec1: 'Never share your CLI ACCESS token; anyone holding it can change your bot code. If it leaks, rotate it from BotFather.',
    sec2: 'The generated zip contains <code>tgcloud/lib/seed-config.js</code> with your personal IDs — keep it on your machine only and never publish it to any repository (it is git-ignored in this project).',
    sec3: 'This page has no backend, analytics or cookies; you can audit its source in the repo under <code>docs/</code> before using it.',
    sec4: 'For ownership, the single-use <code>/setup</code> key flow is the most secure option; entering your ID in step 2 is merely more convenient.',
    faq_title: 'FAQ',
    q1: 'Does this site store anything on GitHub or anywhere else?',
    a1: 'No. The page is static HTML/JS; forms are processed in browser memory and the zip is built right there. No request is sent to any server (only the font and the zip library load from a CDN).',
    q2: 'Why does the site not push to Telegram Serverless directly?',
    a2: 'The CLI ACCESS protocol is designed to run from your terminal and cannot be called from a browser (CORS). So this page builds the ready project and gives you the exact CLI commands — the whole deploy is 5 commands.',
    q3: 'How do I change settings later?',
    a3: 'Admins, categories, closing/deleting tickets — everything is managed from the bot’s own panel. For limits or timezone, edit the project’s config.js and push again.',
    foot_left: 'A public-domain project (The Unlicense) — zero personal data in the repository.',
    foot_repo: 'Source on GitHub ↗',
  },
};

let LANG = 'fa';

/* ================= language switch ================= */
function applyLang(l) {
  LANG = l;
  document.documentElement.lang = l;
  document.documentElement.dir = (l === 'fa') ? 'rtl' : 'ltr';
  document.getElementById('lang-fa').classList.toggle('active', l === 'fa');
  document.getElementById('lang-en').classList.toggle('active', l === 'en');

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = DICT[l][el.dataset.i18n];
    if (v != null) el.innerHTML = v;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const v = DICT[l][el.dataset.i18nPh];
    if (v != null) el.placeholder = v;
  });
  // category row placeholders
  document.querySelectorAll('.cat-row .fa-in').forEach((i) => { i.placeholder = DICT[l].cat_fa_ph; });
  document.querySelectorAll('.cat-row .en-in').forEach((i) => { i.placeholder = DICT[l].cat_en_ph; });
}

/* ================= categories rows ================= */
function addCatRow(fa = '', en = '') {
  const row = document.createElement('div');
  row.className = 'cat-row';
  const f = document.createElement('input');
  f.type = 'text'; f.className = 'fa-in'; f.value = fa;
  f.placeholder = DICT[LANG].cat_fa_ph; f.autocomplete = 'off';
  const e = document.createElement('input');
  e.type = 'text'; e.className = 'en-in'; e.value = en;
  e.placeholder = DICT[LANG].cat_en_ph; e.autocomplete = 'off';
  const rm = document.createElement('button');
  rm.type = 'button'; rm.className = 'rm'; rm.title = 'remove'; rm.textContent = '✕';
  rm.setAttribute('aria-label', 'remove category');
  row.append(f, e, rm);
  document.getElementById('cat-rows').appendChild(row);
}

/* ================= collect & validate ================= */
function collectState() {
  const owner = document.getElementById('owner-id').value.trim();
  const adminLines = document.getElementById('admins').value.split('\n').map((s) => s.trim());
  const admins = [];
  const badLines = [];
  adminLines.forEach((line, i) => {
    if (!line) return;
    if (/^\d{2,}$/.test(line)) admins.push(Number(line));
    else badLines.push({ n: i + 1, v: line });
  });
  const cats = [];
  document.querySelectorAll('.cat-row').forEach((row) => {
    const fa = row.querySelector('.fa-in').value.trim();
    const en = row.querySelector('.en-in').value.trim();
    if (fa || en) cats.push({ fa, en });
  });
  const lang = document.querySelector('input[name="dlang"]:checked').value;
  const mpm = clampInt(document.getElementById('adv-mpm').value, 1, 120, 12);
  const cd = clampInt(document.getElementById('adv-cd').value, 0, 3600, 60);
  const tz = document.getElementById('adv-tz').value;
  return { owner, admins, badLines, cats, lang, adv: { mpm, cd, tz } };
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function validate(st) {
  const errs = [];
  if (st.owner && !/^\d{2,}$/.test(st.owner)) errs.push(DICT[LANG].err_bad_owner);
  st.badLines.forEach((b) => {
    errs.push(DICT[LANG].err_bad_admin_line.replace('{n}', b.n).replace('{v}', b.v));
  });
  return errs;
}

/* ================= source patching ================= */
// Patch lib/config.js limits + timezone (deterministic anchor replacements).
function patchConfig(text, adv) {
  let out = text, ok = 0;
  out = out.replace(/(MSGS_PER_MIN:\s*)(\d+)(,)/, (m, p1, p2, p3) => { ok++; return p1 + adv.mpm + p3; });
  out = out.replace(/(NEW_TICKET_COOLDOWN:\s*)(\d+)(,)/, (m, p1, p2, p3) => { ok++; return p1 + adv.cd + p3; });
  out = out.replace(/(TZ_OFFSET_MS = )([\d.]+)( \* 3600 \* 1000)/, (m, p1, p2, p3) => { ok++; return p1 + adv.tz + p3; });
  return { text: out, patches: ok };
}

// Patch lib/i18n.js default language fallback (single deterministic anchor).
function patchI18n(text, lang) {
  if (lang !== 'en') return { text, patched: false };
  const anchor = "return lang === 'en' ? 'en' : 'fa';";
  const enVer = "return lang === 'fa' ? 'fa' : 'en';";
  if (!text.includes(anchor)) return { text, patched: false };
  return { text: text.replace(anchor, enVer), patched: true };
}

// Build tgcloud/lib/seed-config.js content from user input.
function buildSeedConfig(st) {
  const head =
    '// ============================================================\n' +
    '// lib/seed-config.js — YOUR personal deploy-time settings.\n' +
    '// Generated by the web installer. NEVER commit this file and\n' +
    '// never publish the zip: it contains your personal IDs.\n' +
    '// Apply with: npx tgcloud run lib/seed\n' +
    '// ============================================================\n\n';
  const obj = {
    owner_id: st.owner ? Number(st.owner) : 0,
    admins: st.admins,
    categories: st.cats.map((c) => ({ fa: c.fa, en: c.en })),
  };
  return head + 'export default ' + JSON.stringify(obj, null, 2) + ';\n';
}

/* ================= zip building ================= */
async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  const urls = [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
  ];
  for (const u of urls) {
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = u; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      if (window.JSZip) return window.JSZip;
    } catch { /* try next */ }
  }
  return null;
}

async function generateZip() {
  const status = document.getElementById('gen-status');
  const summary = document.getElementById('gen-summary');
  status.className = 'gen-status busy';
  summary.classList.add('hidden');

  if (!window.BOT_FILES || !Object.keys(window.BOT_FILES).length) {
    status.className = 'gen-status err';
    status.textContent = DICT[LANG].gen_missing_files;
    return;
  }
  const st = collectState();
  const errs = validate(st);
  if (errs.length) {
    status.className = 'gen-status err';
    status.innerHTML = errs.map((e) => '❌ ' + esc(e)).join('<br>');
    return;
  }

  status.textContent = DICT[LANG].gen_busy;
  const JSZip = await loadJSZip();
  if (!JSZip) {
    status.className = 'gen-status err';
    status.textContent = DICT[LANG].gen_missing_files;
    return;
  }

  try {
    const files = { ...window.BOT_FILES };

    // advanced options → lib/config.js
    let patchedCfg = 0, patchedI18n = false;
    for (const [path, content] of Object.entries(files)) {
      if (path === 'tgcloud/lib/config.js') {
        const r = patchConfig(content, st.adv);
        files[path] = r.text; patchedCfg = r.patches;
      }
      if (path === 'tgcloud/lib/i18n.js') {
        const r = patchI18n(content, st.lang);
        files[path] = r.text; patchedI18n = r.patched;
      }
    }
    // personal settings → seed-config.js (git-ignored in the project)
    const seedPath = 'tgcloud/lib/seed-config.js';
    if (files[seedPath] === undefined) files[seedPath] = buildSeedConfig(st);

    const zip = new JSZip();
    for (const [path, content] of Object.entries(files)) zip.file(path, content);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'telegram-support-bot-configured.zip';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);

    status.className = 'gen-status ok';
    status.textContent = DICT[LANG].gen_done;

    // summary box
    const items = [];
    items.push(st.owner
      ? DICT[LANG].sum_owner_yes.replace('{v}', st.owner)
      : DICT[LANG].sum_owner_no);
    if (st.admins.length) items.push(DICT[LANG].sum_admins.replace('{n}', st.admins.length));
    if (st.cats.length) items.push(DICT[LANG].sum_cats.replace('{n}', st.cats.length));
    else items.push(DICT[LANG].sum_cats_zero);
    items.push(DICT[LANG].sum_lang.replace('{v}', st.lang === 'fa' ? 'فارسی' : 'English' + (patchedI18n ? '' : '')));
    items.push(DICT[LANG].sum_adv
      .replace('{m}', st.adv.mpm).replace('{c}', st.adv.cd)
      .replace('{t}', Number(st.adv.tz) >= 0 ? '+' + Number(st.adv.tz) : st.adv.tz));
    items.push(DICT[LANG].sum_files.replace('{n}', Object.keys(window.BOT_FILES).length));
    items.push(DICT[LANG].sum_seed);
    summary.innerHTML = '<b>' + DICT[LANG].sum_title + '</b><ul>' +
      items.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul>';
    summary.classList.remove('hidden');

    // scroll to deploy steps
    document.getElementById('s4').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    status.className = 'gen-status err';
    status.textContent = DICT[LANG].gen_error + (e && e.message ? e.message : e);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ================= clipboard ================= */
async function copyText(txt, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(txt); ok = true; } catch { /* fallback */ }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = ok ? DICT[LANG].copied : DICT[LANG].copied_fail;
    btn.classList.toggle('copied', ok);
    setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1600);
  }
}

/* ================= init ================= */
document.addEventListener('DOMContentLoaded', () => {
  applyLang('fa');
  addCatRow();
  document.getElementById('lang-fa').addEventListener('click', () => applyLang('fa'));
  document.getElementById('lang-en').addEventListener('click', () => applyLang('en'));
  document.getElementById('add-cat').addEventListener('click', () => addCatRow());
  document.getElementById('cat-rows').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.rm');
    if (btn) btn.closest('.cat-row').remove();
  });
  document.getElementById('generate').addEventListener('click', generateZip);

  // CLI token helpers (session-only, never leaves the page)
  const token = document.getElementById('cli-token');
  document.getElementById('token-eye').addEventListener('click', () => {
    token.type = token.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('token-copy').addEventListener('click', (ev) => copyText(token.value.trim(), ev.currentTarget));
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(btn.dataset.copy);
      if (el) copyText(el.textContent.trim(), btn);
    });
  });
});
