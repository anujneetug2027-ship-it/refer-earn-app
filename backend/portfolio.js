// ═══════════════════════════════════════════════════════════════
//  portfolio.js  —  AmbikaShelf Portfolio Manager
//  Mount:  app.use('/api/portfolio', require('./portfolio'));
//
//  DATA SOURCES:
//  Stocks       → Yahoo Finance (PRIMARY, reliable from cloud servers)
//                 + NSE India as opportunistic secondary (often blocked
//                 from cloud/hosting IPs like Render — kept as best-effort)
//  Stock search → Yahoo Finance search API (free, no key)
//  Crypto       → CoinCap.io (free, no key) + CoinGecko fallback
//  Mutual Funds → MFAPI.in (free, no key, full NAV history + search)
//  Gold/Silver/
//  Platinum     → Metals.Dev (spot) + a retail premium adjustment,
//                 since digital-gold apps (Paytm etc.) sell at spot +
//                 GST + dealer spread, not raw spot price.
// ═══════════════════════════════════════════════════════════════

const express  = require('express');
const mongoose = require('mongoose');
const router   = express.Router();
const fetch    = require('node-fetch');

// Same env var name as before (METAL_API_KEY) — just pointed at Metals.Dev now.
const METAL_API_KEY = process.env.METAL_API_KEY || 'P4CP1LRAUOCQKWP0SWBQ734P0SWBQ';

// ══════════════════════════════════════════════════════════════════
//  MONGOOSE SCHEMAS
// ══════════════════════════════════════════════════════════════════
const stockHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  symbol:       { type: String, required: true },
  name:         { type: String, required: true },
  quantity:     { type: Number, required: true, min: 0 },
  buyPrice:     { type: Number, required: true, min: 0 },
  purchaseDate: { type: Date,   required: true },
  addedAt:      { type: Date,   default: Date.now },
});
const cryptoHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  coinId:       { type: String, required: true },
  symbol:       { type: String },   // ticker hint (e.g. "BTC") for Binance lookups
  name:         { type: String, required: true },
  quantity:     { type: Number, required: true, min: 0 },
  buyPrice:     { type: Number, required: true, min: 0 },
  purchaseDate: { type: Date,   required: true },
  leverage:     { type: Number, default: 1, min: 1 },
  addedAt:      { type: Date,   default: Date.now },
});
// assetId: 'gold' | 'silver' | 'platinum'
const utilityHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  assetId:      { type: String, required: true, default: 'gold' },
  name:         { type: String, required: true, default: 'Digital Gold' },
  quantity:     { type: Number, required: true, min: 0 },
  buyPrice:     { type: Number, required: true, min: 0 },
  purchaseDate: { type: Date,   required: true },
  addedAt:      { type: Date,   default: Date.now },
});
// method: 'onetime' | 'sip'
const mutualFundHoldingSchema = new mongoose.Schema({
  userEmail:    { type: String, required: true, index: true },
  schemeCode:   { type: String, required: true },
  name:         { type: String, required: true },
  method:       { type: String, required: true, enum: ['onetime', 'sip'] },
  // one-time lump sum fields
  units:        { type: Number, min: 0 },
  buyPrice:     { type: Number, min: 0 },   // NAV on purchase date
  purchaseDate: { type: Date },
  // SIP fields
  sipAmount:    { type: Number, min: 0 },   // ₹ debited each installment
  sipStartDate: { type: Date },             // first installment date
  sipDay:       { type: Number, min: 1, max: 28 }, // day of month money leaves account
  addedAt:      { type: Date,   default: Date.now },
});

const StockHolding      = mongoose.models.StockHolding      || mongoose.model('StockHolding',      stockHoldingSchema);
const CryptoHolding      = mongoose.models.CryptoHolding     || mongoose.model('CryptoHolding',     cryptoHoldingSchema);
const UtilityHolding     = mongoose.models.UtilityHolding    || mongoose.model('UtilityHolding',    utilityHoldingSchema);
const MutualFundHolding  = mongoose.models.MutualFundHolding || mongoose.model('MutualFundHolding', mutualFundHoldingSchema);

// Periodic real-price snapshots for stocks, taken by the background poller
// below (independent of any user visiting the site) — see getStockChartData
// for how these get merged into the 1H/1D intraday chart series.
const stockPriceSnapshotSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  price:  { type: Number, required: true },
  ts:     { type: Date,   required: true, default: Date.now },
});
stockPriceSnapshotSchema.index({ ts: 1 }, { expireAfterSeconds: 30 * 24 * 3600 }); // auto-expire after 30 days
const StockPriceSnapshot = mongoose.models.StockPriceSnapshot || mongoose.model('StockPriceSnapshot', stockPriceSnapshotSchema);

// Metals persistence — survives process restarts/cold-starts so the
// live-price fetch and the one-time historical backfill (see the METALS
// section below) are true one-time costs, not "once per process lifetime."
const metalLiveSnapshotSchema = new mongoose.Schema({
  _id:       { type: String, default: 'latest' }, // singleton doc
  metals:    { gold: Number, silver: Number, platinum: Number }, // raw spot, INR/gram
  fetchedAt: { type: Date, required: true },
});
const MetalLiveSnapshot = mongoose.models.MetalLiveSnapshot || mongoose.model('MetalLiveSnapshot', metalLiveSnapshotSchema);

const metalDailySpotSchema = new mongoose.Schema({
  date:     { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD, IST
  gold:     Number, silver: Number, platinum: Number, // raw wholesale spot, INR/gram
});
const MetalDailySpot = mongoose.models.MetalDailySpot || mongoose.model('MetalDailySpot', metalDailySpotSchema);

// ══════════════════════════════════════════════════════════════════
//  CACHE
// ══════════════════════════════════════════════════════════════════
var _cache = {};
function getCache(key, ttl) {
  var e = _cache[key];
  return (e && (Date.now() - e.ts) < (ttl || 60000)) ? e.val : null;
}
function setCache(key, val) { _cache[key] = { val: val, ts: Date.now() }; }

// ══════════════════════════════════════════════════════════════════
//  SHARED HELPERS — date math & the P&L engine
// ══════════════════════════════════════════════════════════════════
var DAY_MS = 86400000;
var IST_OFFSET_MS = (5 * 60 + 30) * 60000; // IST is a fixed UTC+5:30, no DST

function daysAgo(n) { return new Date(Date.now() - n * DAY_MS); }

// The most recent occurrence (as a real UTC instant) of a given IST
// wall-clock time (hour:minute) that is at/before "now" — e.g. hour=9,
// minute=15 gives "today's 9:15 AM IST" once that's passed, or
// "yesterday's 9:15 AM IST" before it happens today. This is what makes
// a "day" figure anchored to market open persist unchanged all the way
// through to the next session's open, rather than rolling every 24h.
function lastISTClockTime(hour, minute) {
  var now = new Date();
  var nowIST = new Date(now.getTime() + IST_OFFSET_MS);
  var y = nowIST.getUTCFullYear(), m = nowIST.getUTCMonth(), d = nowIST.getUTCDate();
  var todayAnchorIST = new Date(Date.UTC(y, m, d, hour, minute, 0));
  var todayAnchorUTC = new Date(todayAnchorIST.getTime() - IST_OFFSET_MS);
  if (now.getTime() >= todayAnchorUTC.getTime()) return todayAnchorUTC;
  return new Date(todayAnchorUTC.getTime() - DAY_MS);
}

// Calendar date string (YYYY-MM-DD) as seen from IST, not the server's
// UTC clock — matters near midnight so "yesterday" means yesterday in
// India, not wherever the server happens to be.
function istDateString(date) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().split('T')[0];
}

// Given an ascending series [{t: Date, price: Number}], find the price
// at-or-before a target date (last known price on/prior to that date).
function priceOnOrBefore(series, targetDate) {
  if (!series || !series.length) return null;
  var t = targetDate.getTime();
  var best = null;
  for (var i = 0; i < series.length; i++) {
    if (series[i].t.getTime() <= t) best = series[i];
    else break;
  }
  return best ? best.price : (series[0] ? series[0].price : null);
}

// Find the price at-or-just-after a target date — used for "since market
// open" anchors, where we want the first known tick AT/AFTER open, not
// the last one before it.
function priceOnOrAfter(series, targetDate) {
  if (!series || !series.length) return null;
  var t = targetDate.getTime();
  for (var i = 0; i < series.length; i++) {
    if (series[i].t.getTime() >= t) return series[i].price;
  }
  return series[series.length - 1].price;
}

// Given an ascending series and a "units held as of date" function,
// compute mark-to-market gain over a period: units held at the start
// of the period × (price now − price then).
//
// anchorDate is the explicit point in time to measure from (callers
// decide what that means per period — see computeGainsForHolding).
// anchorPriceOverride lets a caller supply the exact anchor price
// directly (e.g. a stock's actual market-open tick) instead of having
// it derived from `series`, which may be too coarse (daily closes only)
// for that purpose.
//
// If the holding is younger than the anchor (e.g. bought 5 months ago,
// asked for the 1-year figure), the anchor falls before the holding
// existed — which used to report a flat ₹0 "gain", which is misleading.
// Instead we clamp to the holding's inception point and use the *actual*
// buy price/units from inception, so a short-lived holding's "Year" gain
// gracefully equals its "Overall" gain, rather than showing 0.
function periodGain(series, currentPrice, unitsAsOfFn, anchorDate, inception, anchorPriceOverride) {
  if (currentPrice == null) return { abs: null, pct: null, base: null };
  var priceThen, unitsThen;

  if (inception && anchorDate.getTime() < inception.date.getTime()) {
    priceThen = inception.price;
    unitsThen = inception.units;
  } else {
    priceThen = anchorPriceOverride != null ? anchorPriceOverride : priceOnOrBefore(series, anchorDate);
    unitsThen = unitsAsOfFn(anchorDate);
  }

  if (priceThen == null || unitsThen == null) return { abs: null, pct: null, base: null };
  var abs = unitsThen * (currentPrice - priceThen);
  var baseValue = unitsThen * priceThen;
  var pct = baseValue > 0 ? (abs / baseValue) * 100 : null;
  return {
    abs: parseFloat(abs.toFixed(2)),
    pct: pct != null ? parseFloat(pct.toFixed(2)) : null,
    base: parseFloat(baseValue.toFixed(2)),
  };
}

// dayAnchor (optional): { date, price? } — how "Day" should be measured
// for this asset type. Omit it to fall back to a plain rolling 24h
// window (still used for mutual funds and, indirectly, utility — see
// their sections below). Week/Month/Year always stay as rolling
// 7/30/365-day windows regardless of asset type.
function computeGainsForHolding(series, currentPrice, unitsAsOfFn, inception, dayAnchor) {
  var dayAnchorDate  = dayAnchor ? dayAnchor.date : daysAgo(1);
  var dayAnchorPrice = dayAnchor ? dayAnchor.price : undefined;
  return {
    day:     periodGain(series, currentPrice, unitsAsOfFn, dayAnchorDate, inception, dayAnchorPrice),
    week:    periodGain(series, currentPrice, unitsAsOfFn, daysAgo(7), inception),
    month:   periodGain(series, currentPrice, unitsAsOfFn, daysAgo(30), inception),
    year:    periodGain(series, currentPrice, unitsAsOfFn, daysAgo(365), inception),
    overall: inception && currentPrice != null
      ? (function(){
          var abs = inception.units * (currentPrice - inception.price);
          var base = inception.units * inception.price;
          return { abs: parseFloat(abs.toFixed(2)), pct: base > 0 ? parseFloat((abs/base*100).toFixed(2)) : null, base: parseFloat(base.toFixed(2)) };
        })()
      : { abs: null, pct: null, base: null },
  };
}

// Aggregate a list of per-holding gains objects into one total. Percentages
// are recomputed from summed abs/base (not averaged) so a portfolio-level
// "-9.38%" is the real blended return, not a naive average of holdings.
function sumGains(list) {
  var out = {};
  ['day','week','month','year','overall'].forEach(function(k){
    var totalAbs = 0, totalBase = 0, haveAny = false;
    list.forEach(function(g){
      if (g[k] && g[k].abs != null) {
        totalAbs += g[k].abs;
        totalBase += (g[k].base || 0);
        haveAny = true;
      }
    });
    out[k] = {
      abs: haveAny ? parseFloat(totalAbs.toFixed(2)) : null,
      pct: (haveAny && totalBase > 0) ? parseFloat((totalAbs/totalBase*100).toFixed(2)) : null,
      base: haveAny ? parseFloat(totalBase.toFixed(2)) : null,
    };
  });
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  STOCKS — Yahoo Finance PRIMARY, NSE secondary (best-effort)
// ══════════════════════════════════════════════════════════════════
var NSE_SYM = {
  'ITC.NS': 'ITC', 'SUNPHARMA.NS': 'SUNPHARMA', 'TATAPOWER.NS': 'TATAPOWER',
  'ADANIPOWER.NS': 'ADANIPOWER', 'IDEA.NS': 'IDEA', 'OIL.NS': 'OIL',
  'ETERNAL.NS': 'ETERNAL', 'GMDC.NS': 'GMDC', 'LUPIN.NS': 'LUPIN',
  'AUROPHARMA.NS': 'AUROPHARMA', 'PNB.NS': 'PNB', 'BEL.NS': 'BEL',
  'ADANIENT.NS': 'ADANIENT',
};

var YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

var NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/', 'Origin': 'https://www.nseindia.com',
  'Connection': 'keep-alive',
};

// Grab NSE session cookies first (NSE rejects cold requests with no cookie jar).
// This is best-effort: many cloud hosts (Render, Heroku, etc.) are IP-blocked
// by NSE regardless, so this is a bonus source, never the only one.
var _nseCookieCache = null, _nseCookieTs = 0;
async function getNSECookies() {
  if (_nseCookieCache && (Date.now() - _nseCookieTs) < 600000) return _nseCookieCache;
  try {
    var r = await fetch('https://www.nseindia.com/', { headers: NSE_HEADERS });
    var raw = r.headers.raw()['set-cookie'];
    if (raw && raw.length) {
      _nseCookieCache = raw.map(function(c){ return c.split(';')[0]; }).join('; ');
      _nseCookieTs = Date.now();
      return _nseCookieCache;
    }
  } catch (e) { console.error('[nse cookie]', e.message); }
  return null;
}

async function getNSEPrice(sym) {
  var nseSym = NSE_SYM[sym] || sym.replace('.NS', '').replace('.BO', '');
  try {
    var cookie = await getNSECookies();
    var headers = Object.assign({}, NSE_HEADERS);
    if (cookie) headers.Cookie = cookie;
    var url = 'https://www.nseindia.com/api/quote-equity?symbol=' + encodeURIComponent(nseSym);
    var r = await fetch(url, { headers: headers });
    if (r.ok) {
      var d = await r.json();
      var price = d && d.priceInfo && (d.priceInfo.lastPrice || d.priceInfo.close);
      if (price) return parseFloat(price);
    }
  } catch (e) { console.error('[nse price]', sym, e.message); }
  return null;
}

// Yahoo chart endpoint gives us live-ish price AND real historical closes
// in one call — this is now the primary source for both current price
// and the P&L history series.
async function getYahooChart(sym, range, interval) {
  try {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym)
      + '?interval=' + (interval || '1d') + '&range=' + (range || '2y');
    var r = await fetch(url, { headers: YF_HEADERS });
    if (!r.ok) return null;
    var d = await r.json();
    var res = d && d.chart && d.chart.result && d.chart.result[0];
    if (!res) return null;
    var ts     = res.timestamp || [];
    var closes = res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close || [];
    var series = [];
    for (var i = 0; i < ts.length; i++) {
      if (closes[i] == null || isNaN(closes[i])) continue;
      series.push({ t: new Date(ts[i] * 1000), price: parseFloat(closes[i].toFixed(2)) });
    }
    var meta = res.meta || {};
    var live = meta.regularMarketPrice != null ? parseFloat(meta.regularMarketPrice) : (series.length ? series[series.length - 1].price : null);
    return { series: series, live: live };
  } catch (e) { console.error('[yahoo chart]', sym, e.message); return null; }
}

// Cached 2y daily history — the backbone for stock P&L period gains + charts.
async function getStockHistory(sym) {
  var ck = 'sh:' + sym;
  var cached = getCache(ck, 21600000); // 6h
  if (cached) return cached;
  var y = await getYahooChart(sym, '2y', '1d');
  if (y && y.series.length) { setCache(ck, y); return y; }
  return { series: [], live: null };
}

// "Day" for a stock = today's price vs the previous trading day's
// closing price — the standard "day change %" convention every broker
// app uses (NOT since market open). Found by walking the daily-close
// series backward from the most recent point whose IST calendar date is
// strictly before today's — skipping any row that might represent
// today's still-in-progress session — rather than a naive "24h ago"
// lookup, which can misfire near midnight or during market hours.
async function getStockPrevCloseAnchor(sym) {
  var ck = 'spc:' + sym;
  var cached = getCache(ck, 300000); // 5 min
  if (cached !== null) return cached;
  var hist = await getStockHistory(sym);
  if (!hist.series.length) return null;
  var todayIST = istDateString(new Date());
  var found = null;
  for (var i = hist.series.length - 1; i >= 0; i--) {
    if (istDateString(hist.series[i].t) < todayIST) { found = hist.series[i]; break; }
  }
  if (!found) found = hist.series[0];
  var out = { date: found.t, price: found.price };
  setCache(ck, out);
  return out;
}

async function getStockPrice(sym) {
  var ck = 'sp:' + sym;
  var cached = getCache(ck, 60000);
  if (cached !== null) return cached;

  // 1. Yahoo — most reliable from a server/cloud IP
  var hist = await getStockHistory(sym);
  if (hist.live) { setCache(ck, hist.live); return hist.live; }

  // 2. NSE — best-effort secondary (works from residential/whitelisted IPs)
  var nse = await getNSEPrice(sym);
  if (nse) { setCache(ck, nse); return nse; }

  return null;
}

// Intraday (1H/1D) chart uses a finer Yahoo interval; longer ranges use
// the cached 2y daily history sliced to range — all REAL data, no simulation.
var RANGE_DAYS = { '1H': 1, '1D': 1, '1W': 7, '1M': 30, '3M': 90, '1Y': 365, '2Y': 730 };
var NSE_SESSION_MS = (6 * 60 + 15) * 60000; // 9:15 AM -> 3:30 PM IST

// Read our own periodically-stored real prices for a symbol since a given
// time — see startStockPricePoller() below.
async function getStoredStockSnapshots(sym, sinceMs) {
  try {
    var rows = await StockPriceSnapshot.find({ symbol: sym, ts: { $gte: new Date(sinceMs) } }).sort({ ts: 1 }).lean();
    return rows.map(function(r){ return { x: r.ts.getTime(), y: r.price }; });
  } catch (e) { console.error('[stock snapshot read]', sym, e.message); return []; }
}

// Merge two ascending [{x,y}] series (Yahoo's feed + our own poller
// snapshots), dropping points within 60s of one another so the two
// sources don't produce near-duplicate ticks.
function mergeTimeSeries(a, b) {
  var all = a.concat(b).sort(function(p, q){ return p.x - q.x; });
  var out = [];
  for (var i = 0; i < all.length; i++) {
    if (out.length && Math.abs(all[i].x - out[out.length - 1].x) < 60000) continue;
    out.push(all[i]);
  }
  return out;
}

async function getStockChartData(sym, range) {
  if (range === '1H') {
    var cutoff1 = Date.now() - 3600000;
    var ownSnaps1 = await getStoredStockSnapshots(sym, cutoff1);
    var y1 = await getYahooChart(sym, '5d', '5m');
    if (y1 && y1.series.length) {
      var sliced1 = y1.series.filter(function(p){ return p.t.getTime() >= cutoff1; }).map(function(p){ return { x: p.t.getTime(), y: p.price }; });
      var merged1 = mergeTimeSeries(sliced1, ownSnaps1);
      if (merged1.length >= 2) return merged1;
      return y1.series.map(function(p){ return { x: p.t.getTime(), y: p.price }; });
    }
    if (ownSnaps1.length >= 2) return ownSnaps1;
  }
  if (range === '1D') {
    // Exactly ONE trading session — 9:15 AM to 3:30 PM IST of whichever
    // session is current (today's, if the market has opened today;
    // otherwise the most recently completed one) — never a rolling
    // window that bleeds into an adjacent day's session.
    var sessionStart = lastISTClockTime(9, 15);
    var sessionEnd = Math.min(sessionStart.getTime() + NSE_SESSION_MS, Date.now());
    var ownSnaps2 = await getStoredStockSnapshots(sym, sessionStart.getTime());
    var y2 = await getYahooChart(sym, '5d', '15m');
    if (y2 && y2.series.length) {
      var sliced2 = y2.series.filter(function(p){
        var t = p.t.getTime();
        return t >= sessionStart.getTime() && t <= sessionEnd;
      }).map(function(p){ return { x: p.t.getTime(), y: p.price }; });
      // Our own poller runs every 5-10 min around the clock (see
      // startStockPricePoller), so merging it in fills whatever gaps
      // Yahoo's free/anonymous intraday feed leaves — this is what keeps
      // the day's chart a real continuous line instead of jumping
      // straight from the last time someone had the app open to now.
      var merged2 = mergeTimeSeries(sliced2, ownSnaps2.filter(function(p){ return p.x <= sessionEnd; }));
      if (merged2.length >= 2) return merged2;
      return y2.series.map(function(p){ return { x: p.t.getTime(), y: p.price }; });
    }
    if (ownSnaps2.length >= 2) return ownSnaps2;
  }
  var hist = await getStockHistory(sym);
  var days = RANGE_DAYS[range] || 365;
  var cutoff = Date.now() - days * DAY_MS;
  return hist.series.filter(function(p){ return p.t.getTime() >= cutoff; }).map(function(p){ return { x: p.t.getTime(), y: p.price }; });
}

// Keeps real stock prices flowing in even when nobody has the site open —
// every 5 minutes DURING NSE MARKET HOURS ONLY, fetch the current price
// for every distinct symbol any user actually holds and store it.
// getStockChartData() above then blends these into the 1H/1D charts, so
// reopening the app after a few hours shows the real path the price took
// meanwhile rather than a single straight line from the last visit to now.
//
// Restricted to market hours because NSE prices don't move after 3:30 PM
// (or before 9:15 AM, or on weekends) — polling around the clock just
// wrote the same closing price over and over, which showed up as
// pointless flat segments padding out the 1H/1D chart after hours.
var STOCK_POLL_MS = 5 * 60 * 1000;
var _stockPollerStarted = false;

function isNSEMarketOpenNow() {
  var nowIST = new Date(Date.now() + IST_OFFSET_MS);
  var day = nowIST.getUTCDay(); // in IST wall-clock terms, since we shifted the instant
  if (day === 0 || day === 6) return false; // Sat/Sun — exchange closed
  var minutesOfDay = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
  return minutesOfDay >= (9 * 60 + 15) && minutesOfDay <= (15 * 60 + 30);
}

async function pollAndStoreStockPrices() {
  if (!isNSEMarketOpenNow()) return;
  try {
    var symbols = await StockHolding.distinct('symbol');
    for (var i = 0; i < symbols.length; i++) {
      var sym = symbols[i];
      try {
        var price = await getStockPrice(sym);
        if (price != null) await StockPriceSnapshot.create({ symbol: sym, price: price, ts: new Date() });
      } catch (e) { console.error('[stock snapshot]', sym, e.message); }
    }
  } catch (e) { console.error('[stock snapshot poll]', e.message); }
}

function startStockPricePoller() {
  if (_stockPollerStarted) return;
  _stockPollerStarted = true;
  setTimeout(pollAndStoreStockPrices, 15000); // give the DB connection a moment on cold start
  setInterval(pollAndStoreStockPrices, STOCK_POLL_MS);
}
startStockPricePoller();

// Stock search — lets users find the correct symbol instead of relying on
// a hand-maintained list (fixes tickers that previously showed "—").
async function searchStocks(q) {
  try {
    var url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q)
      + '&quotesCount=15&newsCount=0';
    var r = await fetch(url, { headers: YF_HEADERS });
    if (!r.ok) return [];
    var d = await r.json();
    var quotes = (d && d.quotes) || [];
    return quotes
      .filter(function(q2){ return q2.quoteType === 'EQUITY' && (q2.exchange === 'NSI' || q2.exchange === 'BSE'); })
      .map(function(q2){
        return {
          symbol: q2.symbol,
          name: q2.longname || q2.shortname || q2.symbol,
          exchange: q2.exchange === 'NSI' ? 'NSE' : 'BSE',
        };
      });
  } catch (e) { console.error('[stock search]', q, e.message); return []; }
}

// ══════════════════════════════════════════════════════════════════
//  CRYPTO — CoinGecko PRIMARY, Kraken secondary, Binance tertiary,
//  CoinPaprika last-resort (price only)
//
//  Binance was tried as primary previously, which was the wrong call:
//  Binance's public market-data API enforces a hard geo-block ("Service
//  unavailable from a restricted location") against US-region IPs, and
//  Render's servers are commonly US-hosted — so it would work briefly
//  (whatever cached values survived) and then go completely blank once
//  every call started hitting the block, which matches "working
//  yesterday, blank today" exactly. Binance is now just an opportunistic
//  extra fallback, never depended on.
//
//  CoinGecko's keyless API is the most broadly-compatible free option
//  (it does 403 a *few* cloud IP ranges like Cloudflare Workers, but
//  that's narrower than Binance's blanket US geo-block) — so it's back
//  to being primary. Kraken sits right behind it: free, no key, not
//  known for geo-blocking cloud hosts, and gives real historical OHLC
//  candles (unlike CoinPaprika's free tier, which is current-price only).
// ══════════════════════════════════════════════════════════════════
var CG_HEADERS = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
var EXCHANGE_HEADERS = { 'Accept': 'application/json' };

// Kraken uses its own quirky pair codes (BTC is "XBT") — map the coins
// this app ships with; anything else guesses SYMBOL+"USD" and just tries.
var KRAKEN_PAIR = {
  'bitcoin': 'XBTUSD', 'ethereum': 'ETHUSD', 'solana': 'SOLUSD',
  'dogecoin': 'DOGEUSD', 'chainlink': 'LINKUSD',
};
var BINANCE_SYMBOL = {
  'bitcoin': 'BTCUSDT', 'ethereum': 'ETHUSDT', 'solana': 'SOLUSDT',
  'dogecoin': 'DOGEUSDT', 'chainlink': 'LINKUSDT', 'bitget-token': 'BGBUSDT',
};

function guessKrakenPair(id, symbolHint) {
  if (KRAKEN_PAIR[id]) return KRAKEN_PAIR[id];
  if (symbolHint) {
    var sym = symbolHint.toUpperCase();
    if (sym === 'BTC') sym = 'XBT';
    return sym + 'USD';
  }
  return null;
}
function guessBinanceSymbol(id, symbolHint) {
  if (BINANCE_SYMBOL[id]) return BINANCE_SYMBOL[id];
  if (symbolHint) return symbolHint.toUpperCase().replace(/USDT$/, '') + 'USDT';
  return null;
}

// USD/INR via Frankfurter (ECB-backed, free, keyless, rarely blocked);
// CoinGecko's tether/inr pair as fallback.
async function getUSDINRRate() {
  var cached = getCache('usdinr', 3600000);
  if (cached) return cached;
  try {
    var r = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR');
    if (r.ok) {
      var d = await r.json();
      var rate = d && d.rates && d.rates.INR;
      if (rate) { setCache('usdinr', rate); return rate; }
    }
  } catch (e) { console.error('[frankfurter usd-inr]', e.message); }
  try {
    var r2 = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr', { headers: CG_HEADERS });
    if (r2.ok) {
      var d2 = await r2.json();
      var rate2 = d2 && d2.tether && d2.tether.inr;
      if (rate2) { setCache('usdinr', rate2); return rate2; }
    }
  } catch (e) { console.error('[coingecko usd-inr]', e.message); }
  return 88; // last-resort static fallback
}

async function getKrakenPriceUSD(pair) {
  try {
    var r = await fetch('https://api.kraken.com/0/public/Ticker?pair=' + encodeURIComponent(pair), { headers: EXCHANGE_HEADERS });
    if (r.ok) {
      var d = await r.json();
      if (d && (!d.error || !d.error.length) && d.result) {
        var key = Object.keys(d.result)[0];
        var last = key && d.result[key].c && d.result[key].c[0];
        if (last) return parseFloat(last);
      }
    }
  } catch (e) { console.error('[kraken price]', pair, e.message); }
  return null;
}

var KRAKEN_INTERVAL_CFG = {
  '1H': 1, '1D': 15, '1W': 60, '1M': 240, '3M': 1440, '1Y': 1440, '2Y': 1440,
};

async function getKrakenKlinesUSD(pair, range) {
  var interval = KRAKEN_INTERVAL_CFG[range] || 15;
  try {
    var url = 'https://api.kraken.com/0/public/OHLC?pair=' + encodeURIComponent(pair) + '&interval=' + interval;
    var r = await fetch(url, { headers: EXCHANGE_HEADERS });
    if (r.ok) {
      var d = await r.json();
      if (d && (!d.error || !d.error.length) && d.result) {
        var key = Object.keys(d.result).find(function(k){ return k !== 'last'; });
        var rows = key && d.result[key];
        if (Array.isArray(rows) && rows.length > 1) {
          // row: [time, open, high, low, close, vwap, volume, count]
          return rows.map(function(row){ return { t: row[0] * 1000, priceUsd: parseFloat(row[4]) }; });
        }
      }
    }
  } catch (e) { console.error('[kraken klines]', pair, e.message); }
  return null;
}

async function getBinancePriceUSDT(symbol) {
  try {
    var r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=' + encodeURIComponent(symbol), { headers: EXCHANGE_HEADERS });
    if (r.ok) {
      var d = await r.json();
      if (d && d.price) return parseFloat(d.price);
    }
  } catch (e) { console.error('[binance price]', symbol, e.message); }
  return null;
}

var BINANCE_KLINE_CFG = {
  '1H': { interval: '1m',  limit: 60  }, '1D': { interval: '15m', limit: 96  },
  '1W': { interval: '2h',  limit: 84  }, '1M': { interval: '6h',  limit: 120 },
  '3M': { interval: '1d',  limit: 90  }, '1Y': { interval: '1d',  limit: 365 },
  '2Y': { interval: '3d',  limit: 243 },
};

async function getBinanceKlinesUSDT(symbol, range) {
  var cfg = BINANCE_KLINE_CFG[range] || BINANCE_KLINE_CFG['1D'];
  try {
    var url = 'https://api.binance.com/api/v3/klines?symbol=' + encodeURIComponent(symbol)
      + '&interval=' + cfg.interval + '&limit=' + cfg.limit;
    var r = await fetch(url, { headers: EXCHANGE_HEADERS });
    if (r.ok) {
      var d = await r.json();
      if (Array.isArray(d) && d.length > 1) {
        return d.map(function(row){ return { t: row[0], priceUsdt: parseFloat(row[4]) }; });
      }
    }
  } catch (e) { console.error('[binance klines]', symbol, e.message); }
  return null;
}

async function getCryptoPrice(id, symbolHint) {
  var ck = 'cgp:' + id;
  var cached = getCache(ck, 60000);
  if (cached !== null) return cached;

  try {
    var url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(id) + '&vs_currencies=inr';
    var r = await fetch(url, { headers: CG_HEADERS });
    if (r.ok) {
      var d = await r.json();
      if (d && d[id] && d[id].inr) { setCache(ck, d[id].inr); return d[id].inr; }
    }
  } catch (e) { console.error('[coingecko price]', id, e.message); }

  var rate = null;
  var krakenPair = guessKrakenPair(id, symbolHint);
  if (krakenPair) {
    var usdK = await getKrakenPriceUSD(krakenPair);
    if (usdK) {
      rate = rate || await getUSDINRRate();
      var priceK = usdK * rate;
      setCache(ck, priceK);
      return priceK;
    }
  }

  var binSym = guessBinanceSymbol(id, symbolHint);
  if (binSym) {
    var usdB = await getBinancePriceUSDT(binSym);
    if (usdB) {
      rate = rate || await getUSDINRRate();
      var priceB = usdB * rate;
      setCache(ck, priceB);
      return priceB;
    }
  }

  try {
    var guesses = symbolHint ? [symbolHint.toLowerCase() + '-' + id] : [];
    var r3 = await fetch('https://api.coinpaprika.com/v1/search?q=' + encodeURIComponent(id) + '&c=currencies&limit=1');
    if (r3.ok) {
      var d3 = await r3.json();
      var hit = d3 && d3.currencies && d3.currencies[0];
      if (hit) guesses.unshift(hit.id);
    }
    for (var i = 0; i < guesses.length; i++) {
      var r4 = await fetch('https://api.coinpaprika.com/v1/tickers/' + guesses[i] + '?quotes=USD');
      if (r4.ok) {
        var d4 = await r4.json();
        var usdP = d4 && d4.quotes && d4.quotes.USD && d4.quotes.USD.price;
        if (usdP) {
          rate = rate || await getUSDINRRate();
          var priceP = usdP * rate;
          setCache(ck, priceP);
          return priceP;
        }
      }
    }
  } catch (e) { console.error('[coinpaprika price]', id, e.message); }

  return null;
}

var CG_CHART_DAYS = { '1H':'1','1D':'1','1W':'7','1M':'30','3M':'90','1Y':'365','2Y':'730' };

async function getCryptoChart(id, range, symbolHint) {
  var days = CG_CHART_DAYS[range] || '1';
  try {
    var url = 'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(id) + '/market_chart?vs_currency=inr&days=' + days;
    var r = await fetch(url, { headers: CG_HEADERS });
    if (r.ok) {
      var d = await r.json();
      if (d && d.prices && d.prices.length > 1) return d.prices.map(function(p){ return { x: p[0], y: p[1] }; });
    }
  } catch (e) { console.error('[coingecko chart]', id, e.message); }

  var rate = null;
  var krakenPair = guessKrakenPair(id, symbolHint);
  if (krakenPair) {
    var klinesK = await getKrakenKlinesUSD(krakenPair, range);
    if (klinesK) {
      rate = rate || await getUSDINRRate();
      return klinesK.map(function(k){ return { x: k.t, y: parseFloat((k.priceUsd * rate).toFixed(4)) }; });
    }
  }

  var binSym = guessBinanceSymbol(id, symbolHint);
  if (binSym) {
    var klinesB = await getBinanceKlinesUSDT(binSym, range);
    if (klinesB) {
      rate = rate || await getUSDINRRate();
      return klinesB.map(function(k){ return { x: k.t, y: parseFloat((k.priceUsdt * rate).toFixed(4)) }; });
    }
  }

  return [];
}

// 2y daily series used for period-gain math (independent of chart "range" UI)
async function getCryptoHistory(id, symbolHint) {
  var ck = 'ch:' + id;
  var cached = getCache(ck, 21600000);
  if (cached) return cached;
  var data = await getCryptoChart(id, '2Y', symbolHint);
  var series = data.map(function(p){ return { t: new Date(p.x), price: p.y }; });
  if (series.length) setCache(ck, series);
  return series;
}

// Crypto search — CoinGecko primary, CoinPaprika fallback.
async function searchCrypto(q) {
  try {
    var url = 'https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(q);
    var r = await fetch(url, { headers: CG_HEADERS });
    if (r.ok) {
      var d = await r.json();
      var coins = (d && d.coins) || [];
      if (coins.length) return coins.slice(0, 15).map(function(c){ return { id: c.id, name: c.name, symbol: (c.symbol||'').toUpperCase() }; });
    }
  } catch (e) { console.error('[coingecko search]', q, e.message); }

  try {
    var r2 = await fetch('https://api.coinpaprika.com/v1/search?q=' + encodeURIComponent(q) + '&c=currencies&limit=15');
    if (r2.ok) {
      var d2 = await r2.json();
      var coins2 = (d2 && d2.currencies) || [];
      return coins2.slice(0, 15).map(function(c){ return { id: c.id, name: c.name, symbol: (c.symbol||'').toUpperCase() }; });
    }
  } catch (e) { console.error('[coinpaprika search]', q, e.message); }
  return [];
}

// ══════════════════════════════════════════════════════════════════
//  METALS — Gold / Silver / Platinum via Metals.Dev + retail premium
//
//  API CREDIT STRATEGY:
//  • LIVE PRICE: Metals.Dev's /v1/latest returns gold+silver+platinum
//    in ONE call (already converted to INR/gram — no oz/currency math
//    needed). Cached in memory for 5 HOURS and shared by every visitor
//    in this process; also persisted to Mongo so a restart within that
//    5h window reuses the DB copy instead of re-fetching.
//  • HISTORY (for the graph + week/month/year returns): Metals.Dev's
//    /v1/timeseries returns up to 30 days of daily rates (for ALL
//    metals at once) per call, in USD/troy-oz, with that day's own
//    USD→INR rate bundled in the same response. On the very first run
//    this app has ever made, we walk back ~370 days in ~13 chunked
//    calls and persist every day's INR/gram price to MongoDB forever
//    (a past day's price is an immutable fact). Every run after that —
//    including after a restart/cold-start, and on every other instance
//    of this app — loads the full year straight from Mongo with ZERO
//    API calls, then fetches only the 1 new day that rolls into the
//    window each time a calendar day passes.
// ══════════════════════════════════════════════════════════════════
var GRAMS_PER_TROY_OZ = 31.1034768;

// Spot prices from Metals.Dev reflect wholesale/LBMA-style rates.
// Retail digital-gold/silver/platinum apps (Paytm, PhonePe, etc.) charge
// spot + GST (3%) + a dealer spread. These premiums are tuned so that,
// against Metals.Dev's current spot, they land close to real Indian
// retail-app prices (~₹16,000/g gold, ~₹246/g silver, ~₹6,960/g
// platinum) — tune further via env vars if your app's rate drifts.
var METAL_PREMIUM_PCT = {
  gold:     parseFloat(process.env.GOLD_PREMIUM_PCT)     || 18.4,
  silver:   parseFloat(process.env.SILVER_PREMIUM_PCT)   || 20.3,
  platinum: parseFloat(process.env.PLATINUM_PREMIUM_PCT) || 25.3,
};
var METAL_FALLBACK = { gold: 16000, silver: 246, platinum: 6960 };
var METAL_NAME = { gold: 'Digital Gold', silver: 'Digital Silver', platinum: 'Digital Platinum' };

// Sticky "last known good" store — never expires on its own, only ever
// overwritten by a fresh successful fetch. Used as the fallback before
// the hardcoded METAL_FALLBACK constant.
var _stickyGood = {};

function applyPremium(spotPerGram, type) {
  var pct = METAL_PREMIUM_PCT[type] || 0;
  return spotPerGram * (1 + pct / 100);
}

// ── LIVE PRICE (shared 5h cache across all visitors) ──
var LIVE_PRICE_TTL = 5 * 60 * 60 * 1000; // 5 hours

async function getMetalLatestSnapshot() {
  var ck = 'metals:latest';
  var cached = getCache(ck, LIVE_PRICE_TTL);
  if (cached !== null) return cached;

  // Second line of defense against restarts/cold-starts: if some earlier
  // run (this process or another instance) already fetched within the
  // last 5h, reuse that instead of spending another API credit.
  try {
    var doc = await MetalLiveSnapshot.findById('latest').lean();
    if (doc && doc.fetchedAt && (Date.now() - new Date(doc.fetchedAt).getTime()) < LIVE_PRICE_TTL) {
      var reused = { status: 'success', metals: doc.metals };
      setCache(ck, reused);
      return reused;
    }
  } catch (e) { console.error('[metals live db read]', e.message); }

  try {
    var url = 'https://api.metals.dev/v1/latest?api_key=' + METAL_API_KEY + '&currency=INR&unit=g';
    var r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.ok) {
      var d = await r.json();
      if (d && d.status === 'success' && d.metals) {
        setCache(ck, d);
        MetalLiveSnapshot.updateOne(
          { _id: 'latest' },
          { metals: d.metals, fetchedAt: new Date() },
          { upsert: true }
        ).catch(function(e){ console.error('[metals live db write]', e.message); });
        return d;
      }
      if (d && d.error_message) console.error('[metals.dev latest]', d.error_code, d.error_message);
    }
  } catch (e) { console.error('[metals.dev latest]', e.message); }
  return null;
}

async function getMetalPrice(type) {
  var snap = await getMetalLatestSnapshot();
  if (snap && snap.metals && snap.metals[type] != null) {
    var price = applyPremium(snap.metals[type], type); // already INR/gram — no oz/currency math needed
    _stickyGood['mp:' + type] = price;
    return price;
  }
  // Fetch failed (quota exhausted, network hiccup, etc.) — prefer the
  // last real price we successfully saw over a hardcoded constant.
  return _stickyGood['mp:' + type] != null ? _stickyGood['mp:' + type] : METAL_FALLBACK[type];
}

// ── HISTORY (permanent in-memory backfill, done once) ──
// _dailyMetalSpotINR['YYYY-MM-DD'] = { gold, silver, platinum } — raw
// wholesale spot in INR/gram (premium applied at read time, so changing
// a *_PREMIUM_PCT env var instantly re-prices all cached history too).
var _dailyMetalSpotINR = {};
var _metalHistoryBackfillDone = false;
var _metalHistoryBackfillPromise = null;
var METAL_HISTORY_DAYS = 370;   // a little over a year, so 365-day anchors always resolve
var METAL_HISTORY_CHUNK = 29;   // Metals.Dev timeseries caps a request at 30 days

async function fetchMetalTimeseriesChunk(startDate, endDate) {
  try {
    var url = 'https://api.metals.dev/v1/timeseries?api_key=' + METAL_API_KEY
      + '&start_date=' + istDateString(startDate) + '&end_date=' + istDateString(endDate);
    var r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.ok) {
      var d = await r.json();
      if (d && d.status === 'success' && d.rates) return d.rates;
      if (d && d.error_message) console.error('[metals.dev timeseries]', d.error_code, d.error_message);
    }
  } catch (e) { console.error('[metals.dev timeseries]', e.message); }
  return null;
}

// Walks back METAL_HISTORY_DAYS: first loads whatever's already persisted
// in MongoDB (from any prior run of this app, ever — a past day's price
// never changes, so once a day is in the DB it's done for good), then
// hits the API only for the genuinely missing offsets — normally NONE
// after the very first run, or just the 1 new day that rolls into the
// window each time a calendar day passes. Guarded so concurrent
// site-opens during a cold start share one backfill, not racing duplicates.
async function ensureMetalHistoryBackfilled() {
  if (_metalHistoryBackfillDone) return;
  if (_metalHistoryBackfillPromise) return _metalHistoryBackfillPromise;

  _metalHistoryBackfillPromise = (async function() {
    // 1) Load everything already persisted — zero API calls.
    try {
      var docs = await MetalDailySpot.find({}).lean();
      docs.forEach(function(doc) {
        _dailyMetalSpotINR[doc.date] = { gold: doc.gold, silver: doc.silver, platinum: doc.platinum };
      });
    } catch (e) { console.error('[metals history db read]', e.message); }

    // 2) Find the actual gap within the window we care about (offsets 1
    //    through METAL_HISTORY_DAYS days ago). On a fresh DB this is the
    //    whole window (~13 chunked calls, once, ever). On every later
    //    restart it's typically empty, or just the newest 1-2 days.
    var minMissing = null, maxMissing = null;
    for (var i = 1; i <= METAL_HISTORY_DAYS; i++) {
      if (!_dailyMetalSpotINR[istDateString(daysAgo(i))]) {
        if (minMissing === null) minMissing = i;
        maxMissing = i;
      }
    }

    if (minMissing !== null) {
      var newlyFetched = {};
      var endOffset = minMissing;
      while (endOffset <= maxMissing) {
        var startOffset = Math.min(endOffset + METAL_HISTORY_CHUNK - 1, maxMissing);
        var rates = await fetchMetalTimeseriesChunk(daysAgo(startOffset), daysAgo(endOffset));
        if (rates) {
          Object.keys(rates).forEach(function(dateStr) {
            var row = rates[dateStr];
            if (!row || !row.metals) return;
            var inrPerUsd = row.currencies && row.currencies.INR; // value of 1 INR in USD
            if (!inrPerUsd) return;
            var out = {};
            ['gold', 'silver', 'platinum'].forEach(function(m) {
              var usdPerToz = row.metals[m];
              if (usdPerToz == null) return;
              var usdPerGram = usdPerToz / GRAMS_PER_TROY_OZ;
              out[m] = usdPerGram / inrPerUsd; // USD/gram → INR/gram
            });
            _dailyMetalSpotINR[dateStr] = out;
            newlyFetched[dateStr] = out;
          });
        }
        endOffset = startOffset + 1;
      }

      // 3) Persist whatever we just fetched so no process — this one on
      //    its next restart, or any other instance — ever pays for these
      //    dates again.
      var ops = Object.keys(newlyFetched).map(function(ds) {
        var v = newlyFetched[ds];
        return { updateOne: { filter: { date: ds }, update: { $set: { date: ds, gold: v.gold, silver: v.silver, platinum: v.platinum } }, upsert: true } };
      });
      if (ops.length) {
        try { await MetalDailySpot.bulkWrite(ops, { ordered: false }); } catch (e) { console.error('[metals history db write]', e.message); }
      }
    }

    _metalHistoryBackfillDone = true;
  })();

  try { await _metalHistoryBackfillPromise; } finally { _metalHistoryBackfillPromise = null; }
}

async function getMetalHistoricalSpot(type, date) {
  await ensureMetalHistoryBackfilled();
  var dateStr = istDateString(date);
  var row = _dailyMetalSpotINR[dateStr];
  if (row && row[type] != null) return applyPremium(row[type], type);

  // Weekend/holiday gap or a date just outside the backfilled window —
  // fall back to the nearest earlier cached day rather than returning null.
  var keys = Object.keys(_dailyMetalSpotINR).filter(function(k){ return k <= dateStr; }).sort();
  if (keys.length) {
    var nearest = _dailyMetalSpotINR[keys[keys.length - 1]];
    if (nearest && nearest[type] != null) return applyPremium(nearest[type], type);
  }
  return null;
}

// Real-anchored series across the last year — genuine historical data
// points (from the permanent backfill above), linearly interpolated for
// the visual line between them. More anchors than a plain year/month/week
// split so each chart range shows a genuinely different shape.
var METAL_ANCHOR_DAYS = [365, 300, 240, 180, 120, 90, 60, 45, 30, 21, 14, 10, 7, 5, 3, 1, 0];

async function getMetalHistory(type) {
  var points = [];
  for (var i = 0; i < METAL_ANCHOR_DAYS.length; i++) {
    var n = METAL_ANCHOR_DAYS[i];
    var d = n === 0 ? new Date() : daysAgo(n);
    var price = n === 0 ? await getMetalPrice(type) : await getMetalHistoricalSpot(type, d);
    if (price) points.push({ t: d, price: price });
  }
  points.sort(function(a, b){ return a.t - b.t; });
  return points;
}

async function getMetalChartData(type, range) {
  var anchors = await getMetalHistory(type);
  if (anchors.length < 2) return [];
  var days = RANGE_DAYS[range] || 30;
  var cutoff = Date.now() - days * DAY_MS;
  var series = [];
  for (var i = 0; i < anchors.length - 1; i++) {
    var a = anchors[i], b = anchors[i + 1];
    if (b.t.getTime() < cutoff) continue;
    var steps = 12;
    for (var s = 0; s <= steps; s++) {
      var frac = s / steps;
      var t = a.t.getTime() + (b.t.getTime() - a.t.getTime()) * frac;
      if (t < cutoff) continue;
      var price = a.price + (b.price - a.price) * frac;
      series.push({ x: t, y: parseFloat(price.toFixed(2)) });
    }
  }
  return series;
}

// ── NIGHTLY POLLER (keeps data fresh with ZERO visitors) ──
// Every proxy/gains route above only fetches on demand — if nobody hits
// this app for several days, nothing refreshes on its own. That's fine
// for the live/history caches themselves, but it's a real problem for
// anything reading this data without going through a request first (e.g.
// an external monthly-report job) — it would see however-many-days-old
// numbers. This mirrors the stock poller's setInterval pattern above:
// runs independently of any visitor, once per IST calendar day, in a
// late-night window (so that day's closing price is captured before any
// job needing fresh data — like a report firing on the 1st — runs).
var METAL_POLL_CHECK_MS  = 15 * 60 * 1000; // cheap timer tick — costs no API credits by itself
var METAL_NIGHT_HOUR_IST = 23;             // 11 PM IST
var _metalPollerStarted  = false;
var _lastMetalPollDateIST = null;

async function nightlyMetalPollTick() {
  var nowIST = new Date(Date.now() + IST_OFFSET_MS);
  if (nowIST.getUTCHours() !== METAL_NIGHT_HOUR_IST) return; // only act during the night window
  var todayIST = istDateString(new Date());
  if (_lastMetalPollDateIST === todayIST) return; // already ran tonight
  try {
    await getMetalLatestSnapshot();          // refreshes if the 5h cache/DB copy has gone stale
    _metalHistoryBackfillDone = false;        // force tonight's gap-check even if flagged "done" from days ago
    await ensureMetalHistoryBackfilled();     // only actually calls the API if a day is genuinely missing
    _lastMetalPollDateIST = todayIST;
  } catch (e) { console.error('[metal nightly poll]', e.message); }
}

function startMetalPoller() {
  if (_metalPollerStarted) return;
  _metalPollerStarted = true;
  setTimeout(nightlyMetalPollTick, 20000); // give the DB connection a moment on cold start
  setInterval(nightlyMetalPollTick, METAL_POLL_CHECK_MS);
}
startMetalPoller();

// ══════════════════════════════════════════════════════════════════
//  MUTUAL FUNDS — MFAPI.in (free, no key)
// ══════════════════════════════════════════════════════════════════
async function searchMutualFunds(q) {
  try {
    var url = 'https://api.mfapi.in/mf/search?q=' + encodeURIComponent(q);
    var r = await fetch(url);
    if (!r.ok) return [];
    var d = await r.json();
    return (d || []).slice(0, 25).map(function(f){ return { schemeCode: String(f.schemeCode), name: f.schemeName }; });
  } catch (e) { console.error('[mf search]', q, e.message); return []; }
}

// Full NAV history, ascending by date — cached 6h (MFAPI updates ~daily).
async function getMFHistory(code) {
  var ck = 'mfh:' + code;
  var cached = getCache(ck, 21600000);
  if (cached) return cached;
  try {
    var r = await fetch('https://api.mfapi.in/mf/' + encodeURIComponent(code));
    if (!r.ok) return { series: [], meta: null };
    var d = await r.json();
    var series = (d.data || []).map(function(row){
      var parts = row.date.split('-'); // dd-mm-yyyy
      var dt = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      return { t: dt, price: parseFloat(row.nav) };
    }).filter(function(p){ return !isNaN(p.price); });
    series.sort(function(a, b){ return a.t - b.t; });
    var out = { series: series, meta: d.meta || null };
    setCache(ck, out);
    return out;
  } catch (e) { console.error('[mf history]', code, e.message); return { series: [], meta: null }; }
}

async function getMFPrice(code) {
  var hist = await getMFHistory(code);
  if (!hist.series.length) return null;
  return hist.series[hist.series.length - 1].price;
}

// "Day" for a mutual fund = today's NAV vs the previous PUBLISHED NAV —
// not a rolling 24h window. MF NAVs are date-only and typically published
// with a lag (often the "latest" NAV is already >24h old by the time it
// shows up), so a rolling daysAgo(1) anchor frequently lands on the exact
// same data point as "current," always showing a ₹0 / 0% day change. This
// mirrors getStockPrevCloseAnchor's approach: current price minus the
// entry right before it in the series, whatever that entry's date is.
async function getMFPrevNavAnchor(code) {
  var hist = await getMFHistory(code);
  var s = hist.series;
  if (s.length < 2) return null;
  return { date: s[s.length - 2].t, price: s[s.length - 2].price };
}

async function getMFChartData(code, range) {
  var hist = await getMFHistory(code);
  var days = RANGE_DAYS[range] || 365;
  var cutoff = Date.now() - days * DAY_MS;
  var filtered = hist.series.filter(function(p){ return p.t.getTime() >= cutoff; });
  // MF NAVs only update once per trading day, so a 1H/1D window can
  // easily contain 0 or 1 data points (weekend, today's NAV not yet
  // published, etc.). Chart.js needs at least 2 points to draw a line —
  // rather than render nothing, fall back to the most recent known NAV
  // points so the mutual-fund chart always has something to plot instead
  // of going blank whenever the selected range happens to be 1H/1D.
  if (filtered.length < 2 && hist.series.length >= 2) {
    return hist.series.slice(-2).map(function(p){ return { x: p.t.getTime(), y: p.price }; });
  }
  return filtered.map(function(p){ return { x: p.t.getTime(), y: p.price }; });
}

// Walk a SIP forward from sipStartDate, one instalment on sipDay of every
// month, up to today. Each instalment buys units at the NAV on/after that
// date (standard SIP convention — the day money actually leaves, funds
// units get allotted at that or the next available NAV).
function computeSIPInstalments(series, sipAmount, sipStartDate, sipDay) {
  var instalments = [];
  if (!series || !series.length) return instalments;
  var start = new Date(sipStartDate);
  var cursor = new Date(start.getFullYear(), start.getMonth(), Math.min(sipDay, 28));
  if (cursor < start) cursor.setMonth(cursor.getMonth() + 1);
  var today = new Date();

  while (cursor <= today) {
    // NAV on/after the instalment date (next available trading NAV)
    var nav = null;
    for (var i = 0; i < series.length; i++) {
      if (series[i].t.getTime() >= cursor.getTime()) { nav = series[i]; break; }
    }
    if (!nav && series.length) nav = series[series.length - 1];
    if (nav) {
      instalments.push({ date: new Date(cursor), nav: nav.price, units: sipAmount / nav.price });
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, Math.min(sipDay, 28));
  }
  return instalments;
}

function sipUnitsAsOf(instalments, asOfDate) {
  var units = 0;
  for (var i = 0; i < instalments.length; i++) {
    if (instalments[i].date.getTime() <= asOfDate.getTime()) units += instalments[i].units;
  }
  return units;
}

// ══════════════════════════════════════════════════════════════════
//  PROXY ROUTES — prices & charts
// ══════════════════════════════════════════════════════════════════
router.get('/proxy/stock', async function(req, res) {
  var sym = req.query.sym;
  if (!sym) return res.json({ price: null });
  var price = await getStockPrice(sym);
  res.json({ price: price });
});

router.get('/proxy/stock-chart', async function(req, res) {
  var sym = req.query.sym, range = req.query.range || '1D';
  if (!sym) return res.json({ data: [] });
  var ck = 'sc:' + sym + ':' + range;
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ data: cached });
  var data = await getStockChartData(sym, range);
  if (data.length) setCache(ck, data);
  res.json({ data: data });
});

router.get('/proxy/stock-search', async function(req, res) {
  var q = req.query.q;
  if (!q || q.length < 2) return res.json({ results: [] });
  var ck = 'ssq:' + q.toLowerCase();
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ results: cached });
  var results = await searchStocks(q);
  setCache(ck, results);
  res.json({ results: results });
});

router.get('/proxy/crypto', async function(req, res) {
  var id = req.query.id, symbol = req.query.symbol;
  if (!id) return res.json({ price: null });
  var price = await getCryptoPrice(id, symbol);
  res.json({ price: price });
});

router.get('/proxy/crypto-chart', async function(req, res) {
  var id = req.query.id, range = req.query.range || '1D', symbol = req.query.symbol;
  if (!id) return res.json({ data: [] });
  var ck = 'cc:' + id + ':' + range;
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ data: cached });
  var data = await getCryptoChart(id, range, symbol);
  if (data.length) setCache(ck, data);
  res.json({ data: data });
});

router.get('/proxy/crypto-search', async function(req, res) {
  var q = req.query.q;
  if (!q || q.length < 2) return res.json({ results: [] });
  var ck = 'csq:' + q.toLowerCase();
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ results: cached });
  var results = await searchCrypto(q);
  setCache(ck, results);
  res.json({ results: results });
});

// Generic metal routes (gold / silver / platinum)
router.get('/proxy/metal', async function(req, res) {
  var type = req.query.type || 'gold';
  var price = await getMetalPrice(type);
  res.json({ price: price, type: type });
});

// For hosts that fully sleep the process when idle (many free tiers do),
// the in-process nightly poller above can't fire on its own — nothing is
// running to fire it. Point an external scheduler (cron-job.org, GitHub
// Actions on a schedule, your host's own cron add-on, etc.) at this route
// once nightly instead; it does the exact same refresh, safely repeatable
// (it costs an API credit only if data is genuinely stale/missing).
router.get('/cron/refresh-metals', async function(req, res) {
  try {
    await getMetalLatestSnapshot();
    _metalHistoryBackfillDone = false;
    await ensureMetalHistoryBackfilled();
    res.json({ success: true });
  } catch (e) {
    console.error('[cron refresh-metals]', e.message);
    res.status(500).json({ success: false, msg: e.message });
  }
});

router.get('/proxy/metal-chart', async function(req, res) {
  var type = req.query.type || 'gold', range = req.query.range || '1D';
  var ck = 'mc:' + type + ':' + range;
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ data: cached });
  var data = await getMetalChartData(type, range);
  if (data.length) setCache(ck, data);
  res.json({ data: data });
});

// Legacy gold-only routes kept for backward compatibility
router.get('/proxy/gold', async function(req, res) {
  var price = await getMetalPrice('gold');
  res.json({ price: price || METAL_FALLBACK.gold });
});
router.get('/proxy/gold-chart', async function(req, res) {
  var range = req.query.range || '1D';
  var data = await getMetalChartData('gold', range);
  res.json({ data: data });
});

// Mutual fund routes
router.get('/proxy/mf-search', async function(req, res) {
  var q = req.query.q;
  if (!q || q.length < 2) return res.json({ results: [] });
  var ck = 'mfsq:' + q.toLowerCase();
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ results: cached });
  var results = await searchMutualFunds(q);
  setCache(ck, results);
  res.json({ results: results });
});

router.get('/proxy/mf-price', async function(req, res) {
  var code = req.query.code;
  if (!code) return res.json({ price: null });
  var price = await getMFPrice(code);
  res.json({ price: price });
});

router.get('/proxy/mf-chart', async function(req, res) {
  var code = req.query.code, range = req.query.range || '1M';
  if (!code) return res.json({ data: [] });
  var data = await getMFChartData(code, range);
  res.json({ data: data });
});

// ══════════════════════════════════════════════════════════════════
//  AUTH MIDDLEWARE
// ══════════════════════════════════════════════════════════════════
function requireUser(req, res, next) {
  var email = req.headers['x-user-email'];
  if (!email) return res.status(401).json({ success: false, msg: 'Not authenticated' });
  req.userEmail = email.toLowerCase().trim();
  next();
}

// ══════════════════════════════════════════════════════════════════
//  PORTFOLIO CRUD
// ══════════════════════════════════════════════════════════════════
router.get('/holdings', requireUser, async function(req, res) {
  try {
    var results = await Promise.all([
      StockHolding.find({ userEmail: req.userEmail }).lean(),
      CryptoHolding.find({ userEmail: req.userEmail }).lean(),
      UtilityHolding.find({ userEmail: req.userEmail }).lean(),
      MutualFundHolding.find({ userEmail: req.userEmail }).lean(),
    ]);
    res.json({ success: true, portfolio: { stocks: results[0], crypto: results[1], utility: results[2], mutualfunds: results[3] } });
  } catch (e) {
    console.error('[holdings]', e.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

router.post('/add', requireUser, async function(req, res) {
  var b = req.body;
  var type = b.type;

  try {
    var h;
    if (type === 'stocks') {
      if (!b.name || !b.quantity || !b.buyPrice || !b.purchaseDate)
        return res.json({ success: false, msg: 'Missing required fields' });
      if (parseFloat(b.quantity) <= 0 || parseFloat(b.buyPrice) <= 0)
        return res.json({ success: false, msg: 'Quantity and price must be > 0' });
      h = new StockHolding({
        userEmail: req.userEmail, symbol: b.assetKey, name: b.name,
        quantity: parseFloat(b.quantity), buyPrice: parseFloat(b.buyPrice), purchaseDate: new Date(b.purchaseDate)
      });

    } else if (type === 'crypto') {
      if (!b.name || !b.quantity || !b.buyPrice || !b.purchaseDate)
        return res.json({ success: false, msg: 'Missing required fields' });
      if (parseFloat(b.quantity) <= 0 || parseFloat(b.buyPrice) <= 0)
        return res.json({ success: false, msg: 'Quantity and price must be > 0' });
      h = new CryptoHolding({
        userEmail: req.userEmail, coinId: b.assetKey, symbol: b.symbol || null, name: b.name,
        quantity: parseFloat(b.quantity), buyPrice: parseFloat(b.buyPrice),
        purchaseDate: new Date(b.purchaseDate), leverage: parseInt(b.leverage) || 1
      });

    } else if (type === 'utility') {
      if (!b.quantity || !b.buyPrice || !b.purchaseDate)
        return res.json({ success: false, msg: 'Missing required fields' });
      if (parseFloat(b.quantity) <= 0 || parseFloat(b.buyPrice) <= 0)
        return res.json({ success: false, msg: 'Quantity and price must be > 0' });
      var mType = b.assetKey || 'gold';
      h = new UtilityHolding({
        userEmail: req.userEmail, assetId: mType,
        name: b.name || METAL_NAME[mType] || 'Digital Gold',
        quantity: parseFloat(b.quantity), buyPrice: parseFloat(b.buyPrice), purchaseDate: new Date(b.purchaseDate)
      });

    } else if (type === 'mutualfund') {
      if (!b.schemeCode || !b.name || !b.method)
        return res.json({ success: false, msg: 'Missing required fields' });

      if (b.method === 'onetime') {
        // Same convention as stocks/crypto/utility: units + price (NAV) + date.
        // The frontend auto-fetches the NAV for the chosen date, but it's
        // an editable field, same as everywhere else.
        var units = parseFloat(b.units);
        var nav   = parseFloat(b.buyPrice);
        if (!b.purchaseDate) return res.json({ success: false, msg: 'Purchase date required' });
        if (!units || units <= 0) return res.json({ success: false, msg: 'Enter a valid unit quantity' });
        if (!nav || nav <= 0) return res.json({ success: false, msg: 'Enter a valid NAV price' });
        h = new MutualFundHolding({
          userEmail: req.userEmail, schemeCode: String(b.schemeCode), name: b.name, method: 'onetime',
          units: units, buyPrice: nav, purchaseDate: new Date(b.purchaseDate)
        });

      } else if (b.method === 'sip') {
        var sipAmount = parseFloat(b.sipAmount);
        var sipDay    = parseInt(b.sipDay);
        if (!b.sipStartDate) return res.json({ success: false, msg: 'SIP start date required' });
        if (!sipAmount || sipAmount <= 0) return res.json({ success: false, msg: 'Enter a valid SIP amount' });
        if (!sipDay || sipDay < 1 || sipDay > 28) return res.json({ success: false, msg: 'SIP date must be between 1 and 28' });
        h = new MutualFundHolding({
          userEmail: req.userEmail, schemeCode: String(b.schemeCode), name: b.name, method: 'sip',
          sipAmount: sipAmount, sipStartDate: new Date(b.sipStartDate), sipDay: sipDay
        });
      } else {
        return res.json({ success: false, msg: 'Invalid mutual fund method' });
      }

    } else {
      return res.json({ success: false, msg: 'Invalid asset type' });
    }

    await h.save();
    res.json({ success: true, id: h._id });
  } catch (e) {
    console.error('[add]', e.message);
    res.status(500).json({ success: false, msg: e.message });
  }
});

router.post('/remove', requireUser, async function(req, res) {
  var type = req.body.type, id = req.body.id;
  if (!type || !id) return res.json({ success: false, msg: 'Missing type or id' });
  try {
    var f = { _id: id, userEmail: req.userEmail };
    if      (type === 'stock' || type === 'stocks')          await StockHolding.deleteOne(f);
    else if (type === 'crypto')                               await CryptoHolding.deleteOne(f);
    else if (type === 'utility')                              await UtilityHolding.deleteOne(f);
    else if (type === 'mutualfund' || type === 'mutualfunds') await MutualFundHolding.deleteOne(f);
    else return res.json({ success: false, msg: 'Invalid type' });
    res.json({ success: true });
  } catch (e) {
    console.error('[remove]', e.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

router.post('/update', requireUser, async function(req, res) {
  var type = req.body.type, id = req.body.id;
  if (!type || !id) return res.json({ success: false, msg: 'Missing type or id' });
  try {
    var f = { _id: id, userEmail: req.userEmail };
    var u = {};
    if (req.body.quantity)     u.quantity     = parseFloat(req.body.quantity);
    if (req.body.buyPrice)     u.buyPrice     = parseFloat(req.body.buyPrice);
    if (req.body.purchaseDate) u.purchaseDate = new Date(req.body.purchaseDate);
    if (req.body.leverage)     u.leverage     = parseInt(req.body.leverage);
    if (req.body.sipAmount)    u.sipAmount    = parseFloat(req.body.sipAmount);
    if (req.body.sipDay)       u.sipDay       = parseInt(req.body.sipDay);
    if      (type === 'stock' || type === 'stocks')          await StockHolding.updateOne(f, u);
    else if (type === 'crypto')                               await CryptoHolding.updateOne(f, u);
    else if (type === 'utility')                              await UtilityHolding.updateOne(f, u);
    else if (type === 'mutualfund' || type === 'mutualfunds') await MutualFundHolding.updateOne(f, u);
    res.json({ success: true });
  } catch (e) {
    console.error('[update]', e.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
//  P&L ENGINE — GET /gains
//  Returns per-holding day/week/month/year gains (₹) plus category and
//  grand totals, all computed from real historical price series.
// ══════════════════════════════════════════════════════════════════
router.get('/gains', requireUser, async function(req, res) {
  try {
    var lists = await Promise.all([
      StockHolding.find({ userEmail: req.userEmail }).lean(),
      CryptoHolding.find({ userEmail: req.userEmail }).lean(),
      UtilityHolding.find({ userEmail: req.userEmail }).lean(),
      MutualFundHolding.find({ userEmail: req.userEmail }).lean(),
    ]);
    var stocks = lists[0], crypto = lists[1], utility = lists[2], mfs = lists[3];

    // ── Stocks ── "Day" = vs the previous trading day's closing price
    // (the standard convention), not since market open.
    var stockGains = await Promise.all(stocks.map(async function(h) {
      var hist = await getStockHistory(h.symbol);
      var current = hist.live;
      var purchaseTs = new Date(h.purchaseDate).getTime();
      var unitsAsOf = function(d) { return d.getTime() >= purchaseTs ? h.quantity : 0; };
      var inception = { date: new Date(h.purchaseDate), price: h.buyPrice, units: h.quantity };
      var prevClose = await getStockPrevCloseAnchor(h.symbol);
      var dayAnchor = prevClose ? { date: prevClose.date, price: prevClose.price } : null;
      return { id: String(h._id), gains: computeGainsForHolding(hist.series, current, unitsAsOf, inception, dayAnchor), currentPrice: current };
    }));

    // ── Crypto ── "Day" = since 12:00 AM IST today (calendar day), not a
    // rolling 24h window. Reuses the already-fetched history series (no
    // extra API call) — its own daily-ish granularity is fine for this.
    var cryptoGains = await Promise.all(crypto.map(async function(h) {
      var series = await getCryptoHistory(h.coinId, h.symbol);
      var current = await getCryptoPrice(h.coinId, h.symbol);
      var lev = h.leverage || 1;
      var purchaseTs = new Date(h.purchaseDate).getTime();
      var unitsAsOf = function(d) { return d.getTime() >= purchaseTs ? h.quantity * lev : 0; };
      var inception = { date: new Date(h.purchaseDate), price: h.buyPrice, units: h.quantity * lev };
      var dayAnchor = { date: lastISTClockTime(0, 0) };
      return { id: String(h._id), gains: computeGainsForHolding(series, current, unitsAsOf, inception, dayAnchor), currentPrice: current };
    }));

    // ── Utility (gold/silver/platinum) ── "Day" = vs yesterday's closing
    // rate (IST calendar date) — metals have no single "market open" time
    // the way NSE does, so a previous-close comparison is what "last
    // closing NAV" means here. getMetalHistoricalSpot already resolves
    // dates against the IST calendar (see istDateString), so the default
    // rolling-1-day anchor already lines up correctly — no override needed.
    var utilGains = await Promise.all(utility.map(async function(h) {
      var series = await getMetalHistory(h.assetId || 'gold');
      var current = await getMetalPrice(h.assetId || 'gold');
      var purchaseTs = new Date(h.purchaseDate).getTime();
      var unitsAsOf = function(d) { return d.getTime() >= purchaseTs ? h.quantity : 0; };
      var inception = { date: new Date(h.purchaseDate), price: h.buyPrice, units: h.quantity };
      return { id: String(h._id), gains: computeGainsForHolding(series, current, unitsAsOf, inception), currentPrice: current };
    }));

    // ── Mutual funds (onetime + SIP) ── "Day" = today's NAV vs the
    // previous published NAV (not a rolling 24h window — see
    // getMFPrevNavAnchor for why that always showed ₹0).
    var mfGains = await Promise.all(mfs.map(async function(h) {
      var hist = await getMFHistory(h.schemeCode);
      var current = hist.series.length ? hist.series[hist.series.length - 1].price : null;
      var unitsAsOf, totalUnits, inception;

      if (h.method === 'sip') {
        var instalments = computeSIPInstalments(hist.series, h.sipAmount, h.sipStartDate, h.sipDay);
        unitsAsOf = function(d) { return sipUnitsAsOf(instalments, d); };
        totalUnits = sipUnitsAsOf(instalments, new Date());
        inception = instalments.length
          ? { date: instalments[0].date, price: instalments[0].nav, units: instalments[0].units }
          : null;
      } else {
        var purchaseTs = new Date(h.purchaseDate).getTime();
        unitsAsOf = function(d) { return d.getTime() >= purchaseTs ? h.units : 0; };
        totalUnits = h.units;
        inception = { date: new Date(h.purchaseDate), price: h.buyPrice, units: h.units };
      }

      var prevNav = await getMFPrevNavAnchor(h.schemeCode);
      var dayAnchor = prevNav ? { date: prevNav.date, price: prevNav.price } : null;

      return {
        id: String(h._id),
        gains: computeGainsForHolding(hist.series, current, unitsAsOf, inception, dayAnchor),
        currentPrice: current,
        totalUnits: totalUnits != null ? parseFloat(totalUnits.toFixed(4)) : null,
        currentValue: (current != null && totalUnits != null) ? parseFloat((current * totalUnits).toFixed(2)) : null,
      };
    }));

    var totals = {
      stocks:      sumGains(stockGains.map(function(g){ return g.gains; })),
      crypto:      sumGains(cryptoGains.map(function(g){ return g.gains; })),
      utility:     sumGains(utilGains.map(function(g){ return g.gains; })),
      mutualfunds: sumGains(mfGains.map(function(g){ return g.gains; })),
    };
    totals.portfolio = sumGains([totals.stocks, totals.crypto, totals.utility, totals.mutualfunds]);

    res.json({
      success: true,
      stocks: stockGains, crypto: cryptoGains, utility: utilGains, mutualfunds: mfGains,
      totals: totals,
    });
  } catch (e) {
    console.error('[gains]', e.message);
    res.status(500).json({ success: false, msg: 'Server error computing gains' });
  }
});

module.exports = router;
module.exports.models = { StockHolding, CryptoHolding, UtilityHolding, MutualFundHolding };
