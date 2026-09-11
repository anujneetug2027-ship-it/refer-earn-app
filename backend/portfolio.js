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
//  Platinum     → MetalPriceAPI (spot) + a retail premium adjustment,
//                 since digital-gold apps (Paytm etc.) sell at spot +
//                 GST + dealer spread, not raw spot price.
// ═══════════════════════════════════════════════════════════════

const express  = require('express');
const mongoose = require('mongoose');
const router   = express.Router();
const fetch    = require('node-fetch');

const METAL_API_KEY = process.env.METAL_API_KEY || '54d0079d3085b015926ed9d17c67931e';

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

function daysAgo(n) { return new Date(Date.now() - n * DAY_MS); }

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

// Given an ascending series and a "units held as of date" function,
// compute mark-to-market gain over a period: units held at the start
// of the period × (price now − price then). This deliberately excludes
// any *new* money added during the period (e.g. a fresh SIP instalment)
// so "gain" never gets confused with "principal added".
function periodGain(series, currentPrice, unitsAsOfFn, periodDays) {
  if (!series || series.length < 1 || currentPrice == null) return { abs: null, pct: null };
  var anchorDate  = daysAgo(periodDays);
  var priceThen   = priceOnOrBefore(series, anchorDate);
  var unitsThen   = unitsAsOfFn(anchorDate);
  if (priceThen == null || unitsThen == null) return { abs: null, pct: null };
  var abs = unitsThen * (currentPrice - priceThen);
  var baseValue = unitsThen * priceThen;
  var pct = baseValue > 0 ? (abs / baseValue) * 100 : null;
  return { abs: parseFloat(abs.toFixed(2)), pct: pct != null ? parseFloat(pct.toFixed(2)) : null };
}

function computeGainsForHolding(series, currentPrice, unitsAsOfFn) {
  return {
    day:   periodGain(series, currentPrice, unitsAsOfFn, 1),
    week:  periodGain(series, currentPrice, unitsAsOfFn, 7),
    month: periodGain(series, currentPrice, unitsAsOfFn, 30),
    year:  periodGain(series, currentPrice, unitsAsOfFn, 365),
  };
}

function sumGains(list) {
  var out = { day:{abs:0,pct:null}, week:{abs:0,pct:null}, month:{abs:0,pct:null}, year:{abs:0,pct:null} };
  ['day','week','month','year'].forEach(function(k){
    var total = 0, haveAny = false;
    list.forEach(function(g){
      if (g[k] && g[k].abs != null) { total += g[k].abs; haveAny = true; }
    });
    out[k].abs = haveAny ? parseFloat(total.toFixed(2)) : null;
  });
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  STOCKS — Yahoo Finance PRIMARY, NSE secondary (best-effort)
// ══════════════════════════════════════════════════════════════════
var NSE_SYM = {
  'ITC.NS': 'ITC', 'SUNPHARMA.NS': 'SUNPHARMA', 'TATAPOWER.NS': 'TATAPOWER',
  'ADANIPOWER.NS': 'ADANIPOWER', 'IDEA.NS': 'IDEA', 'OIL.NS': 'OIL',
  'ZOMATO.NS': 'ZOMATO', 'GMDC.NS': 'GMDC', 'LUPIN.NS': 'LUPIN',
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

async function getStockChartData(sym, range) {
  if (range === '1H' || range === '1D') {
    var y = await getYahooChart(sym, '5d', range === '1H' ? '5m' : '15m');
    if (y && y.series.length) {
      var cutoff = Date.now() - (range === '1H' ? 3600000 : 86400000 * 1.5);
      var sliced = y.series.filter(function(p){ return p.t.getTime() >= cutoff; });
      return (sliced.length >= 2 ? sliced : y.series).map(function(p){ return { x: p.t.getTime(), y: p.price }; });
    }
  }
  var hist = await getStockHistory(sym);
  var days = RANGE_DAYS[range] || 365;
  var cutoff = Date.now() - days * DAY_MS;
  return hist.series.filter(function(p){ return p.t.getTime() >= cutoff; }).map(function(p){ return { x: p.t.getTime(), y: p.price }; });
}

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
//  CRYPTO — CoinCap PRIMARY, CoinGecko fallback
// ══════════════════════════════════════════════════════════════════
var COINCAP = {
  'bitcoin': 'bitcoin', 'ethereum': 'ethereum', 'solana': 'solana',
  'dogecoin': 'dogecoin', 'chainlink': 'chainlink', 'bitget-token': 'bitget-token',
  'arena-z': null,
};

async function getUSDtoINR() {
  var cached = getCache('usdinr', 3600000);
  if (cached) return cached;
  try {
    var r = await fetch('https://api.coincap.io/v2/rates/indian-rupee');
    if (r.ok) {
      var d = await r.json();
      var rate = d && d.data && parseFloat(d.data.rateUsd);
      if (rate && rate > 0) { setCache('usdinr', rate); return rate; }
    }
  } catch (e) { console.error('[usd-inr]', e.message); }
  return 0.012;
}

async function getCryptoPrice(id) {
  var capId = COINCAP[id];
  if (capId) {
    try {
      var r = await fetch('https://api.coincap.io/v2/assets/' + capId);
      var rate = await getUSDtoINR();
      if (r.ok) {
        var d = await r.json();
        var usd = parseFloat(d && d.data && d.data.priceUsd);
        if (usd && rate) return usd / rate;
      }
    } catch (e) { console.error('[coincap price]', id, e.message); }
  }
  try {
    var url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(id) + '&vs_currencies=inr';
    var r2 = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (r2.ok) {
      var d2 = await r2.json();
      if (d2 && d2[id] && d2[id].inr) return d2[id].inr;
    }
  } catch (e) { console.error('[coingecko price fallback]', id, e.message); }
  return null;
}

var COINCAP_INTERVALS = {
  '1H': { iv: 'm1',  ms: 3600000 },     '1D': { iv: 'm5',  ms: 86400000 },
  '1W': { iv: 'm30', ms: 604800000 },   '1M': { iv: 'h2',  ms: 2592000000 },
  '3M': { iv: 'h6',  ms: 7776000000 },  '1Y': { iv: 'd1',  ms: 31536000000 },
  '2Y': { iv: 'd1',  ms: 63072000000 },
};

async function getCryptoChart(id, range) {
  var capId = COINCAP[id];
  var cfg = COINCAP_INTERVALS[range] || COINCAP_INTERVALS['1D'];
  if (capId) {
    try {
      var end = Date.now(), start = end - cfg.ms;
      var url = 'https://api.coincap.io/v2/assets/' + capId + '/history?interval=' + cfg.iv + '&start=' + start + '&end=' + end;
      var r = await fetch(url);
      var rate = await getUSDtoINR();
      if (r.ok && rate) {
        var d = await r.json();
        if (d && d.data && d.data.length > 1) {
          return d.data.map(function(p){ return { x: p.time, y: parseFloat((parseFloat(p.priceUsd) / rate).toFixed(4)) }; });
        }
      }
    } catch (e) { console.error('[coincap chart]', id, e.message); }
  }
  try {
    var DAYS = { '1H':'1','1D':'1','1W':'7','1M':'30','3M':'90','1Y':'365','2Y':'730' };
    var days = DAYS[range] || '1';
    var url2 = 'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(id) + '/market_chart?vs_currency=inr&days=' + days;
    var r2 = await fetch(url2, { headers: { 'Accept': 'application/json' } });
    if (r2.ok) {
      var d2 = await r2.json();
      if (d2 && d2.prices && d2.prices.length > 1) return d2.prices.map(function(p){ return { x: p[0], y: p[1] }; });
    }
  } catch (e) { console.error('[coingecko chart fallback]', id, e.message); }
  return [];
}

// 2y daily series used for period-gain math (independent of chart "range" UI)
async function getCryptoHistory(id) {
  var ck = 'ch:' + id;
  var cached = getCache(ck, 21600000);
  if (cached) return cached;
  var data = await getCryptoChart(id, '2Y');
  var series = data.map(function(p){ return { t: new Date(p.x), price: p.y }; });
  setCache(ck, series);
  return series;
}

// ══════════════════════════════════════════════════════════════════
//  METALS — Gold / Silver / Platinum via MetalPriceAPI + retail premium
// ══════════════════════════════════════════════════════════════════
// Spot prices from MetalPriceAPI reflect wholesale/LBMA-style rates.
// Retail digital-gold/silver/platinum apps (Paytm, PhonePe, etc.) charge
// spot + GST (3%) + a dealer spread — typically pushing the shown rate
// noticeably above raw spot. These premiums are an approximation to get
// closer to what you'd actually see in-app; tune via env vars if needed.
var METAL_SYMBOL = { gold: 'XAU', silver: 'XAG', platinum: 'XPT' };
var METAL_PREMIUM_PCT = {
  gold:     parseFloat(process.env.GOLD_PREMIUM_PCT)     || 12,
  silver:   parseFloat(process.env.SILVER_PREMIUM_PCT)   || 15,
  platinum: parseFloat(process.env.PLATINUM_PREMIUM_PCT) || 10,
};
var METAL_FALLBACK = { gold: 7400, silver: 95, platinum: 3300 };
var METAL_NAME = { gold: 'Digital Gold', silver: 'Digital Silver', platinum: 'Digital Platinum' };

function applyPremium(spotPerGram, type) {
  var pct = METAL_PREMIUM_PCT[type] || 0;
  return spotPerGram * (1 + pct / 100);
}

async function getMetalSpotPerGram(type) {
  var sym = METAL_SYMBOL[type];
  if (!sym) return null;
  try {
    var url = 'https://api.metalpriceapi.com/v1/latest?api_key=' + METAL_API_KEY + '&base=INR&currencies=' + sym;
    var r = await fetch(url);
    if (r.ok) {
      var d = await r.json();
      if (d && d.rates && d.rates[sym]) return (1 / d.rates[sym]) / 31.1035; // troy oz → gram
    }
  } catch (e) { console.error('[metal spot]', type, e.message); }
  return null;
}

async function getMetalPrice(type) {
  var ck = 'mp:' + type;
  var cached = getCache(ck, 60000);
  if (cached !== null) return cached;
  var spot = await getMetalSpotPerGram(type);
  var price = spot ? applyPremium(spot, type) : METAL_FALLBACK[type];
  setCache(ck, price);
  return price;
}

async function getMetalHistoricalSpot(type, date) {
  var sym = METAL_SYMBOL[type];
  var dateStr = date.toISOString().split('T')[0];
  var ck = 'mh:' + type + ':' + dateStr;
  var cached = getCache(ck, 86400000);
  if (cached !== null) return cached;
  try {
    var url = 'https://api.metalpriceapi.com/v1/' + dateStr + '?api_key=' + METAL_API_KEY + '&base=INR&currencies=' + sym;
    var r = await fetch(url);
    if (r.ok) {
      var d = await r.json();
      if (d && d.rates && d.rates[sym]) {
        var spot = (1 / d.rates[sym]) / 31.1035;
        var price = applyPremium(spot, type);
        setCache(ck, price);
        return price;
      }
    }
  } catch (e) { console.error('[metal historical]', type, dateStr, e.message); }
  return null;
}

// Build a real-anchored series: today + 1d/7d/30d/365d ago, all fetched
// from the historical endpoint (genuine data points), linearly interpolated
// for the visual line between anchors — no random-walk simulation.
async function getMetalHistory(type) {
  var ck = 'mser:' + type;
  var cached = getCache(ck, 21600000);
  if (cached) return cached;

  var anchors = [365, 30, 7, 1, 0];
  var points = [];
  for (var i = 0; i < anchors.length; i++) {
    var d = anchors[i] === 0 ? new Date() : daysAgo(anchors[i]);
    var price = anchors[i] === 0 ? await getMetalPrice(type) : await getMetalHistoricalSpot(type, d);
    if (price) points.push({ t: d, price: price });
  }
  points.sort(function(a, b){ return a.t - b.t; });
  setCache(ck, points);
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

async function getMFChartData(code, range) {
  var hist = await getMFHistory(code);
  var days = RANGE_DAYS[range] || 365;
  var cutoff = Date.now() - days * DAY_MS;
  return hist.series.filter(function(p){ return p.t.getTime() >= cutoff; }).map(function(p){ return { x: p.t.getTime(), y: p.price }; });
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
  var id = req.query.id;
  if (!id) return res.json({ price: null });
  var cached = getCache('cp:' + id);
  if (cached !== null) return res.json({ price: cached });
  var price = await getCryptoPrice(id);
  if (price) setCache('cp:' + id, price);
  res.json({ price: price });
});

router.get('/proxy/crypto-chart', async function(req, res) {
  var id = req.query.id, range = req.query.range || '1D';
  if (!id) return res.json({ data: [] });
  var ck = 'cc:' + id + ':' + range;
  var cached = getCache(ck, 300000);
  if (cached) return res.json({ data: cached });
  var data = await getCryptoChart(id, range);
  if (data.length) setCache(ck, data);
  res.json({ data: data });
});

// Generic metal routes (gold / silver / platinum)
router.get('/proxy/metal', async function(req, res) {
  var type = req.query.type || 'gold';
  var price = await getMetalPrice(type);
  res.json({ price: price, type: type });
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
        userEmail: req.userEmail, coinId: b.assetKey, name: b.name,
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
        var amount = parseFloat(b.amount);
        var nav    = parseFloat(b.buyPrice);
        if (!b.purchaseDate) return res.json({ success: false, msg: 'Purchase date required' });
        if (!amount || amount <= 0) return res.json({ success: false, msg: 'Enter a valid invested amount' });
        if (!nav || nav <= 0) return res.json({ success: false, msg: 'Enter a valid NAV price' });
        var units = amount / nav;
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

    // ── Stocks ──
    var stockGains = await Promise.all(stocks.map(async function(h) {
      var hist = await getStockHistory(h.symbol);
      var current = hist.live;
      var purchaseTs = new Date(h.purchaseDate).getTime();
      var unitsAsOf = function(d) { return d.getTime() >= purchaseTs ? h.quantity : 0; };
      return { id: String(h._id), gains: computeGainsForHolding(hist.series, current, unitsAsOf), currentPrice: current };
    }));

    // ── Crypto ──
    var cryptoGains = await Promise.all(crypto.map(async function(h) {
      var series = await getCryptoHistory(h.coinId);
      var current = await getCryptoPrice(h.coinId);
      var lev = h.leverage || 1;
      var purchaseTs = new Date(h.purchaseDate).getTime();
      var unitsAsOf = function(d) { return d.getTime() >= purchaseTs ? h.quantity * lev : 0; };
      return { id: String(h._id), gains: computeGainsForHolding(series, current, unitsAsOf), currentPrice: current };
    }));

    // ── Utility (gold/silver/platinum) ──
    var utilGains = await Promise.all(utility.map(async function(h) {
      var series = await getMetalHistory(h.assetId || 'gold');
      var current = await getMetalPrice(h.assetId || 'gold');
      var purchaseTs = new Date(h.purchaseDate).getTime();
      var unitsAsOf = function(d) { return d.getTime() >= purchaseTs ? h.quantity : 0; };
      return { id: String(h._id), gains: computeGainsForHolding(series, current, unitsAsOf), currentPrice: current };
    }));

    // ── Mutual funds (onetime + SIP) ──
    var mfGains = await Promise.all(mfs.map(async function(h) {
      var hist = await getMFHistory(h.schemeCode);
      var current = hist.series.length ? hist.series[hist.series.length - 1].price : null;
      var unitsAsOf, totalUnits;

      if (h.method === 'sip') {
        var instalments = computeSIPInstalments(hist.series, h.sipAmount, h.sipStartDate, h.sipDay);
        unitsAsOf = function(d) { return sipUnitsAsOf(instalments, d); };
        totalUnits = sipUnitsAsOf(instalments, new Date());
      } else {
        var purchaseTs = new Date(h.purchaseDate).getTime();
        unitsAsOf = function(d) { return d.getTime() >= purchaseTs ? h.units : 0; };
        totalUnits = h.units;
      }

      return {
        id: String(h._id),
        gains: computeGainsForHolding(hist.series, current, unitsAsOf),
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
