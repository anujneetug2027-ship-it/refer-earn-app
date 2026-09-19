const { Resend } = require("resend");
const crypto = require("crypto");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail({ to, subject, html, attachments = [] }) {
  return await resend.emails.send({
    from: "AmbikaShelf Portfolio Manager <reports@ambikashelf.in>",
    to,
    subject,
    html,
    attachments
  });
}

/* ══════════════════════════════════════════════════════════════════════
 *  MONTHLY PORTFOLIO REPORT
 *
 *  1st of every month (from 9:00 AM IST) →
 *    for every user who has holdings:
 *      1. load their portfolio through the app's own /api/portfolio routes
 *      2. render monthlyreport.html in headless Chromium (Puppeteer)
 *      3. screenshot the 6 A4 pages → PDF → password-protect it
 *      4. email it through Resend using monthlyReportEmail.js
 *
 *  Safe to restart / run twice: every (user, month) is tracked in the
 *  `monthlyreportlogs` collection, so nobody gets the same report twice.
 *
 *  Needs:  npm i puppeteer        (pdf-lib, mongoose, resend already installed)
 *  Env:    CRON_SECRET            (optional, enables the manual/cron URL)
 *          REPORT_BASE_URL        (optional, defaults to http://127.0.0.1:PORT)
 *          SUPPORT_EMAIL          (optional, defaults to support@ambikashelf.in)
 *          MONTHLY_REPORTS_ENABLED=false  to switch the scheduler off
 * ══════════════════════════════════════════════════════════════════════ */

const REPORT_CONFIG = {
  sendHourIST: 9,                  // don't start before 9:00 AM IST on the 1st
  graceDays: 3,                    // if the server was down on the 1st, catch up until the 3rd
  tickMs: 10 * 60 * 1000,          // scheduler check interval
  maxAttempts: 3,                  // per user per month
  staleClaimMs: 45 * 60 * 1000,    // a crashed "processing" claim is retried after this
  pauseBetweenUsersMs: 1500,       // stay well under Resend's rate limit
  timeoutMs: 120 * 1000,           // page render / API timeout
  // Shown in the email as the *format example* only. The user's real PDF
  // password is never put in the email that carries the PDF.
  passwordExample: "ANUJ2008",
  supportEmail: process.env.SUPPORT_EMAIL || "support@ambikashelf.in"
};

// Where the User document keeps these values (first match wins). Adjust if
// your models/User.js uses different field names.
const USER_FIELDS = {
  birth: ["dob", "dateOfBirth", "birthDate", "birthYear", "yearOfBirth"],
  mobile: ["mobile", "phone"]
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const log = (...a) => console.log("[monthly-report]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ─────────────── dates ─────────────── */

function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS); // read with getUTC*()
}

function monthInfoFromKey(key) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(key || ""));
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  return { key: m[1] + "-" + m[2], year, monthIndex, name: MONTH_NAMES[monthIndex] };
}

function previousMonthInfo(nowIST) {
  let y = nowIST.getUTCFullYear();
  let m = nowIST.getUTCMonth() - 1;
  if (m < 0) { m = 11; y -= 1; }
  return monthInfoFromKey(y + "-" + String(m + 1).padStart(2, "0"));
}

/* ─────────────── PDF password ─────────────── */

function getBirthYear(user) {
  const nowYear = new Date().getFullYear();
  for (const field of USER_FIELDS.birth) {
    const v = user && user[field];
    if (v === undefined || v === null || v === "") continue;
    let year = null;
    if (v instanceof Date) year = v.getFullYear();
    else if (typeof v === "number") year = v;
    else {
      const m = String(v).match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
      if (m) year = Number(m[1]);
    }
    if (year && year >= 1900 && year <= nowYear) return year;
  }
  return null;
}

// "First 4 letters of your name in CAPITAL followed by your birth year."
// Accents are stripped and only A–Z are used, so the password is always
// something the user can type on any keyboard. Names shorter than 4 letters
// use all of their letters.
function buildPdfPassword(name, birthYear) {
  const letters = String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 4);
  if (!letters || !birthYear) return null;
  return letters + String(birthYear);
}

/* ─────────────── PDF build + encryption ───────────────
 * Same RC4 routine used by POST /api/pdf/create in server.js. Unlike the
 * route, this version THROWS if it cannot encrypt, so an unprotected
 * report can never be emailed by accident.
 */
const PDF_PAD = Buffer.from([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41,
  0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
  0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A
]);
const md5 = (d) => crypto.createHash("md5").update(d).digest();
const padPwd = (p) => Buffer.concat([Buffer.from(p || "", "latin1").slice(0, 32), PDF_PAD]).slice(0, 32);

function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xFF;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = Buffer.alloc(data.length);
  let x = 0, y = 0;
  for (let i = 0; i < data.length; i++) {
    x = (x + 1) & 0xFF;
    y = (y + S[x]) & 0xFF;
    [S[x], S[y]] = [S[y], S[x]];
    out[i] = data[i] ^ S[(S[x] + S[y]) & 0xFF];
  }
  return out;
}

function encryptPdf(pdfBuf, userPwd) {
  const fileId = crypto.randomBytes(16);
  const perms = -3904;
  const uPad = padPwd(userPwd);
  const oPad = padPwd(userPwd + "_owner");
  const oEntry = rc4(md5(oPad).slice(0, 5), uPad);
  const permBuf = Buffer.alloc(4); permBuf.writeInt32LE(perms, 0);
  const encKey = md5(Buffer.concat([uPad, oEntry, permBuf, fileId])).slice(0, 5);
  const uEntry = rc4(encKey, PDF_PAD);
  const idHex = fileId.toString("hex");
  const oeHex = oEntry.toString("hex");
  const ueHex = uEntry.toString("hex");

  const str = pdfBuf.toString("binary");

  const xrefPos = str.lastIndexOf("\nxref\n");
  if (xrefPos === -1) throw new Error("PDF encryption failed: xref table not found");
  const xrefSection = str.slice(xrefPos + 1);
  const xm = xrefSection.match(/xref\n0 (\d+)\n([\s\S]+?)\ntrailer\n([\s\S]+?)\nstartxref/);
  if (!xm) throw new Error("PDF encryption failed: could not parse xref table");

  const objOffsets = {};
  xm[2].split("\n").filter((l) => l.trim()).forEach((entry, idx) => {
    const parts = entry.trim().split(" ");
    if (parts[2] === "n") objOffsets[idx] = parseInt(parts[0], 10);
  });

  const outBuf = Buffer.from(pdfBuf);

  for (const [objNumStr, offset] of Object.entries(objOffsets)) {
    const objNum = parseInt(objNumStr, 10);
    if (objNum === 0) continue;

    const slice = str.slice(offset, offset + 300000);
    const endObjPos = slice.indexOf("\nendobj");
    const objContent = endObjPos !== -1 ? slice.slice(0, endObjPos) : slice;

    const hasStream = objContent.includes("\nstream\n") || objContent.includes("\nstream\r\n");
    if (!hasStream) continue;

    const lenMatch = objContent.match(/\/Length\s+(\d+)/);
    if (!lenMatch) continue;
    const streamLen = parseInt(lenMatch[1], 10);

    const smCR = objContent.indexOf("\nstream\r\n");
    const sm = objContent.indexOf("\nstream\n");
    let streamDataOffset;
    if (smCR !== -1 && (sm === -1 || smCR < sm)) streamDataOffset = offset + smCR + 9;
    else streamDataOffset = offset + sm + 8;

    const objKey = md5(Buffer.concat([
      encKey, Buffer.from([objNum & 0xFF, (objNum >> 8) & 0xFF, (objNum >> 16) & 0xFF, 0, 0])
    ])).slice(0, Math.min(encKey.length + 5, 16));

    rc4(objKey, outBuf.slice(streamDataOffset, streamDataOffset + streamLen))
      .copy(outBuf, streamDataOffset);
  }

  const maxObj = Math.max(...Object.keys(objOffsets).map(Number));
  const encObjNum = maxObj + 1;
  const encObjStr =
    encObjNum + " 0 obj\n<<\n/Filter /Standard\n/V 1\n/R 2\n/Length 40\n" +
    "/P " + perms + "\n/O <" + oeHex + ">\n/U <" + ueHex + ">\n>>\nendobj\n\n";

  const encObjOffset = xrefPos + 1;
  const newBody = outBuf.toString("binary").slice(0, xrefPos + 1) + encObjStr;
  const totalObjs = encObjNum + 1;

  let xrefTable = "xref\n0 " + totalObjs + "\n" + xm[2];
  xrefTable += String(encObjOffset).padStart(10, "0") + " 00000 n \n";

  let newTrailer = xm[3].trim().replace(/\/Size \d+/, "/Size " + totalObjs);
  newTrailer = newTrailer.replace("<<", "<< /Encrypt " + encObjNum + " 0 R /ID [<" + idHex + "><" + idHex + ">]");

  const result = newBody + xrefTable + "\ntrailer\n" + newTrailer +
    "\n\nstartxref\n" + newBody.length + "\n%%EOF\n";
  const out = Buffer.from(result, "binary");

  if (!out.toString("binary").includes("/Encrypt")) throw new Error("PDF encryption failed: output is not encrypted");
  return out;
}

// PNG page images (A4 portrait) → one password-protected PDF Buffer.
async function buildProtectedPdf(pngBuffers, password) {
  if (!password) throw new Error("Refusing to build a report PDF without a password");
  const { PDFDocument } = require("pdf-lib");
  const W = 595.28, H = 841.89;

  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const png of pngBuffers) {
    const img = await doc.embedPng(png);
    const page = doc.addPage([W, H]);
    const { width: iW, height: iH } = img.size();
    const scale = Math.min(W / iW, H / iH);
    page.drawImage(img, { x: (W - iW * scale) / 2, y: (H - iH * scale) / 2, width: iW * scale, height: iH * scale });
  }
  // Traditional xref table (no object streams) is what encryptPdf() expects.
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return encryptPdf(bytes, password);
}

/* ─────────────── report data (same source the browser page uses) ─────────────── */

function getBaseUrl() {
  return (process.env.REPORT_BASE_URL || ("http://127.0.0.1:" + (process.env.PORT || 5000))).replace(/\/+$/, "");
}

async function apiGet(path, email) {
  const _fetch = global.fetch || require("node-fetch");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REPORT_CONFIG.timeoutMs);
  try {
    const r = await _fetch(getBaseUrl() + path, { headers: { "x-user-email": email }, signal: ctrl.signal });
    let d;
    try { d = await r.json(); } catch (e) { throw new Error("Invalid response from " + path + " (" + r.status + ")"); }
    if (!r.ok || d.success === false) throw new Error(d.msg || ("Request failed: " + path));
    return d;
  } finally {
    clearTimeout(timer);
  }
}

async function collectReportData(email, user, info) {
  const enc = encodeURIComponent;
  const [h, g] = await Promise.all([
    apiGet("/api/portfolio/holdings", email),
    apiGet("/api/portfolio/gains", email)
  ]);
  const p = h.portfolio || { stocks: [], crypto: [], mutualfunds: [], utility: [] };
  ["stocks", "crypto", "mutualfunds", "utility"].forEach((k) => { p[k] = p[k] || []; });

  const live = {};
  const jobs = [];
  p.stocks.forEach((x) => jobs.push(apiGet("/api/portfolio/proxy/stock?sym=" + enc(x.symbol), email).then((d) => { live[x.symbol] = d.price; }).catch(() => {})));
  p.crypto.forEach((x) => jobs.push(apiGet("/api/portfolio/proxy/crypto?id=" + enc(x.coinId) + "&symbol=" + enc(x.symbol || ""), email).then((d) => { live[x.coinId] = d.price; }).catch(() => {})));
  p.utility.forEach((x) => jobs.push(apiGet("/api/portfolio/proxy/metal?type=" + enc(x.assetId || "gold"), email).then((d) => { live[x.assetId || "gold"] = d.price; }).catch(() => {})));
  p.mutualfunds.forEach((x) => jobs.push(apiGet("/api/portfolio/proxy/mf-price?code=" + enc(x.schemeCode), email).then((d) => { live[x.schemeCode] = d.price; }).catch(() => {})));
  await Promise.allSettled(jobs);

  let mobile = "";
  for (const f of USER_FIELDS.mobile) { if (user && user[f]) { mobile = String(user[f]); break; } }

  return {
    email,
    month: info.key,
    // Last day of the reported month, at noon UTC so the date never drifts across time zones.
    reportDate: new Date(Date.UTC(info.year, info.monthIndex + 1, 0, 12, 0, 0)).toISOString(),
    profile: { name: (user && user.name) || "", mobile, email },
    signature: "/icons/signature.png",
    portfolio: p,
    gains: g,
    live
  };
}

/* ─────────────── render monthlyreport.html → PNG pages ─────────────── */

// `browser` is a Puppeteer Browser. The report page is loaded from this
// server, fed the data through sessionStorage (the page already supports
// that), and every .report-page (A4) is screenshotted at 2×.
async function renderReportPages(browser, data) {
  const base = getBaseUrl();
  const timeout = REPORT_CONFIG.timeoutMs;
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 2 });
    try { await page.emulateTimezone("Asia/Kolkata"); } catch (e) { /* non-fatal */ }

    await page.evaluateOnNewDocument((payload, cfg) => {
      try { sessionStorage.setItem("ambikashelf_report_data", JSON.stringify(payload)); } catch (e) {}
      window.REPORT_CONFIG = cfg;
    }, data, { apiBase: base, assetBase: base });

    await page.goto(base + "/monthlyreport.html?embedded=1", { waitUntil: "domcontentloaded", timeout });
    await page.waitForFunction(
      "window.__AMBICASHELF_CHARTS_READY === true && document.querySelectorAll('.report-page').length > 0",
      { timeout }
    );

    const problem = await page.evaluate(() => {
      const box = document.querySelector(".error-box");
      return box ? box.textContent.trim() : "";
    });
    if (problem) throw new Error("Report page reported an error: " + problem);

    // Fonts + images settled before capturing.
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
      await Promise.all(Array.from(document.images).map((img) =>
        img.complete ? null : new Promise((res) => {
          img.addEventListener("load", res, { once: true });
          img.addEventListener("error", res, { once: true });
          setTimeout(res, 10000);
        })
      ));
    });
    await sleep(400);

    const els = await page.$$(".report-page");
    if (!els.length) throw new Error("No report pages were rendered");
    const pngs = [];
    for (const el of els) pngs.push(Buffer.from(await el.screenshot({ type: "png" })));
    return pngs;
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

async function launchBrowser() {
  let puppeteer;
  try { puppeteer = require("puppeteer"); }
  catch (e) { throw new Error("Puppeteer is not installed. Run: npm i puppeteer"); }
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"]
  });
}

/* ─────────────── one user: build + send ─────────────── */

async function sendMonthlyReportEmail({ to, firstName, info, monthlyReturn, assetReturns, pdf }) {
  const { buildMonthlyReportEmail } = require("./monthlyReportEmail");
  const html = buildMonthlyReportEmail({
    name: firstName,
    month: info.name,
    year: info.year,
    monthlyReturnPercent: monthlyReturn,
    assetReturns,
    pdfPassword: REPORT_CONFIG.passwordExample,
    supportEmail: REPORT_CONFIG.supportEmail
  });

  const res = await sendEmail({
    to,
    subject: "Your AmbikaShelf Portfolio Report - " + info.name + " " + info.year,
    html,
    attachments: [{
      filename: "AmbikaShelf_Monthly_Report_" + info.name + "_" + info.year + ".pdf",
      content: pdf
    }]
  });
  // The Resend SDK returns { data, error } instead of throwing.
  if (res && res.error) throw new Error(res.error.message || JSON.stringify(res.error));
  return res;
}

async function findUser(email) {
  const User = require("./models/User");
  return User.findOne({ email: new RegExp("^" + escapeRegExp(email) + "$", "i") }).lean();
}

// Core pipeline. Returns { status: 'sent' } or { status: 'skipped', reason }.
// Throws on real failures (so the caller can log / retry).
async function buildAndSendReport(email, info, browser) {
  const user = await findUser(email);
  if (!user) return { status: "skipped", reason: "no user account for this email" };
  if (user.monthlyReportsEnabled === false) return { status: "skipped", reason: "user opted out" };

  const password = buildPdfPassword(user.name, getBirthYear(user));
  if (!password) return { status: "skipped", reason: "missing name or birth year - cannot create the PDF password" };

  const data = await collectReportData(email, user, info);
  const p = data.portfolio;
  if (![p.stocks, p.crypto, p.mutualfunds, p.utility].some((l) => l.length)) {
    return { status: "skipped", reason: "no holdings" };
  }

  const pngs = await renderReportPages(browser, data);
  const pdf = await buildProtectedPdf(pngs, password);

  const totals = (data.gains && data.gains.totals) || {};
  const monthPct = (t) => (t && t.month && typeof t.month.pct === "number" ? t.month.pct : null);

  await sendMonthlyReportEmail({
    to: user.email || email,
    firstName: String(user.name || "").trim().split(/\s+/)[0],
    info,
    monthlyReturn: monthPct(totals.portfolio),
    assetReturns: {
      stocks: monthPct(totals.stocks),
      crypto: monthPct(totals.crypto),
      mutualFunds: monthPct(totals.mutualfunds),
      utility: monthPct(totals.utility)
    },
    pdf
  });
  return { status: "sent" };
}

/* ─────────────── de-duplication log ─────────────── */

function getLogModel() {
  const mongoose = require("mongoose");
  if (mongoose.models.MonthlyReportLog) return mongoose.models.MonthlyReportLog;
  const schema = new mongoose.Schema({
    email: { type: String, required: true },
    month: { type: String, required: true },          // "YYYY-MM" of the reported month
    status: { type: String, enum: ["processing", "sent", "failed", "skipped"], default: "processing" },
    attempts: { type: Number, default: 0 },
    claimedAt: Date,
    sentAt: Date,
    reason: String,
    error: String
  }, { timestamps: true });
  schema.index({ email: 1, month: 1 }, { unique: true });
  return mongoose.model("MonthlyReportLog", schema);
}

// Atomically claims (email, month). Returns false if it was already sent /
// skipped / exhausted retries / is being processed by someone else.
async function claim(email, month) {
  const Log = getLogModel();
  const now = new Date();
  try {
    const doc = await Log.findOneAndUpdate(
      {
        email, month,
        $or: [
          { status: "failed", attempts: { $lt: REPORT_CONFIG.maxAttempts } },
          { status: "processing", claimedAt: { $lt: new Date(now - REPORT_CONFIG.staleClaimMs) } }
        ]
      },
      { $set: { status: "processing", claimedAt: now }, $inc: { attempts: 1 } },
      { upsert: true, new: true }
    );
    return !!doc;
  } catch (err) {
    if (err && err.code === 11000) return false; // row exists and is not claimable
    throw err;
  }
}

async function finishLog(email, month, patch) {
  await getLogModel().updateOne({ email, month }, { $set: patch });
}

/* ─────────────── batch run ─────────────── */

let _running = false;

async function listRecipients() {
  const { models } = require("./portfolio"); // { StockHolding, CryptoHolding, UtilityHolding, MutualFundHolding }
  const lists = await Promise.all(Object.values(models).map((M) => M.distinct("userEmail")));
  const set = new Set();
  lists.forEach((arr) => arr.forEach((e) => { if (e) set.add(String(e).toLowerCase().trim()); }));
  return Array.from(set);
}

async function runMonthlyReports(opts = {}) {
  if (_running) return { skipped: "already running" };
  _running = true;
  const info = opts.monthInfo || previousMonthInfo(istNow());
  const summary = { month: info.key, sent: 0, skipped: 0, failed: 0, retryable: 0, pending: 0 };
  let browser = null;

  try {
    const Log = getLogModel();
    const everyone = await listRecipients();
    const finished = new Set(await Log.distinct("email", {
      month: info.key,
      $or: [
        { status: { $in: ["sent", "skipped"] } },
        { status: "failed", attempts: { $gte: REPORT_CONFIG.maxAttempts } }
      ]
    }));
    const todo = everyone.filter((e) => !finished.has(e));
    summary.pending = todo.length;
    if (!todo.length) { log(info.key + ": nothing to send"); return summary; }

    log(info.key + ": " + todo.length + " report(s) to send");
    browser = await launchBrowser();

    for (const email of todo) {
      let claimed = false;
      try {
        claimed = await claim(email, info.key);
        if (!claimed) continue;

        const r = await buildAndSendReport(email, info, browser);
        if (r.status === "sent") {
          summary.sent++;
          await finishLog(email, info.key, { status: "sent", sentAt: new Date(), error: null });
          log("sent to " + email);
        } else {
          summary.skipped++;
          await finishLog(email, info.key, { status: "skipped", reason: r.reason });
          log("skipped " + email + ": " + r.reason);
        }
      } catch (err) {
        summary.failed++;
        log("FAILED " + email + ": " + err.message);
        if (claimed) {
          try { await finishLog(email, info.key, { status: "failed", error: String(err.message).slice(0, 500) }); } catch (e) {}
        }
      }
      await sleep(REPORT_CONFIG.pauseBetweenUsersMs);
    }

    summary.retryable = await Log.countDocuments({
      month: info.key, status: "failed", attempts: { $lt: REPORT_CONFIG.maxAttempts }
    });
    log(info.key + ": done", JSON.stringify(summary));
    return summary;
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
    _running = false;
  }
}

// Manual / test send for one address. Ignores the de-dup log (never writes to it).
async function sendMonthlyReportForUser(email, opts = {}) {
  const info = (opts.month && monthInfoFromKey(opts.month)) || previousMonthInfo(istNow());
  const clean = String(email || "").toLowerCase().trim();
  if (!clean) throw new Error("email is required");
  const browser = await launchBrowser();
  try {
    const r = await buildAndSendReport(clean, info, browser);
    return Object.assign({ email: clean, month: info.key }, r);
  } finally {
    try { await browser.close(); } catch (e) {}
  }
}

/* ─────────────── scheduler ─────────────── */

let _timer = null;
let _doneKey = null;

async function schedulerTick() {
  if (_running) return;
  const now = istNow();
  const day = now.getUTCDate();
  if (day > REPORT_CONFIG.graceDays) return;
  if (day === 1 && now.getUTCHours() < REPORT_CONFIG.sendHourIST) return;

  const info = previousMonthInfo(now);
  if (_doneKey === info.key) return;

  const mongoose = require("mongoose");
  if (mongoose.connection.readyState !== 1) return; // DB not connected yet

  const summary = await runMonthlyReports({ monthInfo: info });
  if (summary && !summary.skipped && summary.retryable === 0) _doneKey = info.key;
}

function startMonthlyReportScheduler() {
  if (_timer) return;
  if (process.env.MONTHLY_REPORTS_ENABLED === "false") {
    log("scheduler disabled (MONTHLY_REPORTS_ENABLED=false)");
    return;
  }
  const tick = () => schedulerTick().catch((e) => log("scheduler error:", e.message));
  _timer = setInterval(tick, REPORT_CONFIG.tickMs);
  setTimeout(tick, 30 * 1000); // catch-up shortly after a restart
  log("scheduler started - reports go out on the 1st from " + REPORT_CONFIG.sendHourIST + ":00 IST");
}

/* ─────────────── optional trigger URL (external cron / manual test) ───────────────
 *  GET /api/cron/monthly-reports?key=CRON_SECRET                         → run the batch now
 *  GET /api/cron/monthly-reports?key=CRON_SECRET&email=me@x.com[&month=2026-03]
 *                                                                        → send ONE report now (test)
 *  The key can also be sent as an  x-cron-key  header. Disabled unless CRON_SECRET is set.
 */
function registerMonthlyReportRoutes(app) {
  app.all("/api/cron/monthly-reports", async (req, res) => {
    const secret = process.env.CRON_SECRET || "";
    const provided = String(req.get("x-cron-key") || (req.query && req.query.key) || "");
    const a = Buffer.from(provided), b = Buffer.from(secret);
    const ok = secret && a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(404).json({ success: false, msg: "Not found" });

    try {
      const q = Object.assign({}, req.query, req.body);
      if (q.month && !monthInfoFromKey(q.month)) return res.status(400).json({ success: false, msg: "month must look like 2026-03" });

      if (q.email) {
        const result = await sendMonthlyReportForUser(q.email, { month: q.month });
        return res.json({ success: true, result });
      }
      runMonthlyReports({ monthInfo: q.month ? monthInfoFromKey(q.month) : undefined })
        .catch((e) => log("manual run error:", e.message));
      return res.status(202).json({ success: true, msg: "Monthly report run started" });
    } catch (err) {
      log("route error:", err.message);
      return res.status(500).json({ success: false, msg: err.message });
    }
  });
}

module.exports = {
  sendEmail,
  startMonthlyReportScheduler,
  registerMonthlyReportRoutes,
  runMonthlyReports,
  sendMonthlyReportForUser,
  _internals: { buildPdfPassword, getBirthYear, encryptPdf, buildProtectedPdf, renderReportPages, previousMonthInfo, monthInfoFromKey }
};
