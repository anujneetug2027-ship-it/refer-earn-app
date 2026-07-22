require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { PDFDocument } = require('pdf-lib');
const User = require('./models/User');
const Referral = require('./models/Referral');
const NotificationSubscriber = require('./models/NotificationSubscriber');
const sendWelcomeMail = require('./welcomeMail');
const walletRoutes = require('./wallet');
const http = require("http");
const { Server } = require("socket.io");
const chatSocket = require("./chatSocket");
const fetch = require('node-fetch');
const app = express();

// ---------- MIDDLEWARE ----------
// ✅ Body parsers MUST come before ANY routes
app.use(cors({ origin: '*', credentials: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: "10mb" }));        // ← MOVED UP ✅
app.use(bodyParser.json());                       // ← MOVED UP ✅
app.use(bodyParser.urlencoded({ extended: true })); // ← MOVED UP ✅
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════

const Razorpay = require('razorpay');


// ─── Init Razorpay (put your keys in .env) ───
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ─── Subscription plan map ───
const PLAN_IDS = {
  pro:     'plan_SZx48IcE73Vlvz',
  premium: 'plan_SZx5SR5dsKPPeQ'
};

// ══════════════════════════════════════════
// POST /api/subscription/create
// Creates a Razorpay subscription for the user
// ══════════════════════════════════════════
app.post('/api/subscription/create', async (req, res) => {
  try {
    const { email, planKey } = req.body;

    if (!email || !planKey || !PLAN_IDS[planKey])
      return res.json({ success: false, msg: 'Invalid request' });

    const subscription = await razorpay.subscriptions.create({
      plan_id:         PLAN_IDS[planKey],
      total_count:     12,      // 12 billing cycles (1 year)
      quantity:        1,
      customer_notify: 1,
      notes:           { email, planKey }
    });

    res.json({ success: true, subscriptionId: subscription.id });

  } catch (err) {
    console.error('❌ /api/subscription/create:', err.message);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// ══════════════════════════════════════════
// POST /api/subscription/verify
// Verifies Razorpay payment signature & upgrades user
// ══════════════════════════════════════════
app.post('/api/subscription/verify', async (req, res) => {
  try {
    const {
      email,
      planKey,
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature
    } = req.body;

    // Verify signature
    const body      = razorpay_payment_id + '|' + razorpay_subscription_id;
    const expected  = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature)
      return res.json({ success: false, msg: 'Payment verification failed' });

    // Save plan to user in DB
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: 'User not found' });

    user.plan              = planKey;
    user.planExpiresAt     = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    user.subscriptionId    = razorpay_subscription_id;
    await user.save();

    res.json({ success: true, plan: planKey });

  } catch (err) {
    console.error('❌ /api/subscription/verify:', err.message);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// ══════════════════════════════════════════
// POST /api/coupon/claim
// Validates a coupon code and upgrades user's plan
// ══════════════════════════════════════════

// Simple in-memory coupon store (or move to MongoDB collection)
// Format: { CODE: { plan: 'pro'|'premium', days: 30, uses: 1 } }
// You can generate and add codes here, or pull from a DB collection.
const COUPONS = {
  // Example coupons — replace or manage dynamically
  // 'FREEPRO30': { plan: 'pro',     days: 30, maxUses: 100, usedBy: [] },
  'PREMIUM7':  { plan: 'premium', days:  7, maxUses:  50, usedBy: [] },
};

app.post('/api/coupon/claim', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.json({ success: false, msg: 'Missing fields' });

    const coupon = COUPONS[code.toUpperCase()];
    if (!coupon)
      return res.json({ success: false, msg: 'Invalid or expired coupon code.' });

    if (coupon.maxUses && coupon.usedBy.length >= coupon.maxUses)
      return res.json({ success: false, msg: 'This coupon has reached its usage limit.' });

    if (coupon.usedBy.includes(email))
      return res.json({ success: false, msg: 'You have already claimed this coupon.' });

    // Mark as used
    coupon.usedBy.push(email);

    // Upgrade user
    const user = await User.findOne({ email });
    if (user) {
      user.plan          = coupon.plan;
      user.planExpiresAt = new Date(Date.now() + coupon.days * 24 * 60 * 60 * 1000);
      await user.save();
    }

    res.json({ success: true, plan: coupon.plan, days: coupon.days });

  } catch (err) {
    console.error('❌ /api/coupon/claim:', err.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});




// ────────────────────────────────────────────────────────────────────────
const portfolioRoutes = require('./portfolio');
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/portfolio', (req, res, next) => {
  console.log('Portfolio route hit:', req.method, req.path);
  next();
}, portfolioRoutes);
// ── PASTE THIS ROUTE BLOCK into server.js (after your middleware section) ──

app.post('/api/pdf/create', async (req, res) => {
  const crypto = require('crypto');
  const { PDFDocument } = require('pdf-lib');

  const PDF_PAD = Buffer.from([
    0x28,0xBF,0x4E,0x5E,0x4E,0x75,0x8A,0x41,
    0x64,0x00,0x4E,0x56,0xFF,0xFA,0x01,0x08,
    0x2E,0x2E,0x00,0xB6,0xD0,0x68,0x3E,0x80,
    0x2F,0x0C,0xA9,0xFE,0x64,0x53,0x69,0x7A
  ]);
  const md5 = d => crypto.createHash('md5').update(d).digest();
  const padPwd = p => Buffer.concat([Buffer.from(p||'','latin1').slice(0,32), PDF_PAD]).slice(0,32);
  function rc4(key, data) {
    const S=new Uint8Array(256); for(let i=0;i<256;i++) S[i]=i; let j=0;
    for(let i=0;i<256;i++){j=(j+S[i]+key[i%key.length])&0xFF;[S[i],S[j]]=[S[j],S[i]];}
    const out=Buffer.alloc(data.length); let x=0,y=0;
    for(let i=0;i<data.length;i++){x=(x+1)&0xFF;y=(y+S[x])&0xFF;[S[x],S[y]]=[S[y],S[x]];out[i]=data[i]^S[(S[x]+S[y])&0xFF];}
    return out;
  }

  function encryptPdf(pdfBuf, userPwd) {
    const fileId  = crypto.randomBytes(16);
    const perms   = -3904;
    const uPad    = padPwd(userPwd);
    const oPad    = padPwd(userPwd + '_owner');
    const oEntry  = rc4(md5(oPad).slice(0,5), uPad);
    const permBuf = Buffer.alloc(4); permBuf.writeInt32LE(perms, 0);
    const encKey  = md5(Buffer.concat([uPad, oEntry, permBuf, fileId])).slice(0, 5);
    const uEntry  = rc4(encKey, PDF_PAD);
    const idHex   = fileId.toString('hex');
    const oeHex   = oEntry.toString('hex');
    const ueHex   = uEntry.toString('hex');

    const str = pdfBuf.toString('binary');

    // Parse xref to get exact object offsets
    const xrefPos = str.lastIndexOf('\nxref\n');
    if (xrefPos === -1) return pdfBuf;
    const xrefSection = str.slice(xrefPos + 1);
    const xm = xrefSection.match(/xref\n0 (\d+)\n([\s\S]+?)\ntrailer\n([\s\S]+?)\nstartxref/);
    if (!xm) return pdfBuf;

    const objOffsets = {};
    xm[2].split('\n').filter(l => l.trim()).forEach((entry, idx) => {
      const parts = entry.trim().split(' ');
      if (parts[2] === 'n') objOffsets[idx] = parseInt(parts[0]);
    });

    // Copy buffer so we can encrypt streams in place (RC4 keeps same length)
    const outBuf = Buffer.from(pdfBuf);

    for (const [objNumStr, offset] of Object.entries(objOffsets)) {
      const objNum = parseInt(objNumStr);
      if (objNum === 0) continue;

      // Read only up to 'endobj' to avoid spilling into the next object
      const slice    = str.slice(offset, offset + 300000);
      const endObjPos = slice.indexOf('\nendobj');
      const objContent = endObjPos !== -1 ? slice.slice(0, endObjPos) : slice;

      // Skip objects with no stream
      const hasStream = objContent.includes('\nstream\n') || objContent.includes('\nstream\r\n');
      if (!hasStream) continue;

      // Get stream length from /Length in this object's dict
      const lenMatch = objContent.match(/\/Length\s+(\d+)/);
      if (!lenMatch) continue;
      const streamLen = parseInt(lenMatch[1]);

      // Find exact start of stream data
      const smCR = objContent.indexOf('\nstream\r\n');
      const sm   = objContent.indexOf('\nstream\n');
      let streamDataOffset;
      if (smCR !== -1 && (sm === -1 || smCR < sm)) {
        streamDataOffset = offset + smCR + 9;
      } else {
        streamDataOffset = offset + sm + 8;
      }

      // Per-object RC4 key
      const objKey = md5(Buffer.concat([
        encKey, Buffer.from([objNum&0xFF, (objNum>>8)&0xFF, (objNum>>16)&0xFF, 0, 0])
      ])).slice(0, Math.min(encKey.length + 5, 16));

      rc4(objKey, outBuf.slice(streamDataOffset, streamDataOffset + streamLen))
        .copy(outBuf, streamDataOffset);
    }

    // Append /Encrypt object before xref
    const maxObj    = Math.max(...Object.keys(objOffsets).map(Number));
    const encObjNum = maxObj + 1;
    const encObjStr =
      encObjNum + ' 0 obj\n<<\n/Filter /Standard\n/V 1\n/R 2\n/Length 40\n' +
      '/P ' + perms + '\n/O <' + oeHex + '>\n/U <' + ueHex + '>\n>>\nendobj\n\n';

    const encObjOffset = xrefPos + 1;
    const newBody      = outBuf.toString('binary').slice(0, xrefPos + 1) + encObjStr;
    const totalObjs    = encObjNum + 1;

    // Keep all existing xref entries unchanged (offsets still valid), add one new entry
    let xrefTable = 'xref\n0 ' + totalObjs + '\n' + xm[2];
    xrefTable += String(encObjOffset).padStart(10, '0') + ' 00000 n \n';

    let newTrailer = xm[3].trim().replace(/\/Size \d+/, '/Size ' + totalObjs);
    newTrailer = newTrailer.replace('<<',
      '<< /Encrypt ' + encObjNum + ' 0 R /ID [<' + idHex + '><' + idHex + '>]');

    const result = newBody + xrefTable + '\ntrailer\n' + newTrailer +
                   '\n\nstartxref\n' + newBody.length + '\n%%EOF\n';
    return Buffer.from(result, 'binary');
  }

  try {
    const { images=[], rotations=[], password='', name='AmbikaShelf', pageSize='a4', orientation='p' } = req.body;
    if (!images.length) return res.status(400).json({ success:false, msg:'No images' });

    const sizes = { a4:[595.28,841.89], letter:[612,792], a3:[841.89,1190.55] };
    let [W, H] = sizes[pageSize] || sizes.a4;
    if (orientation === 'l') [W, H] = [H, W];

    const pdfDoc = await PDFDocument.create();
    for (let i = 0; i < images.length; i++) {
      const dataUri = images[i];
      const bytes   = Buffer.from(dataUri.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const img     = dataUri.startsWith('data:image/png') ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const page    = pdfDoc.addPage([W, H]);
      const { width:iW, height:iH } = img.size();
      const rot   = rotations[i] || 0;
      const scale = (rot===90||rot===270) ? Math.min(W/iH,H/iW) : Math.min(W/iW,H/iH);
      page.drawImage(img, { x:(W-iW*scale)/2, y:(H-iH*scale)/2, width:iW*scale, height:iH*scale });
    }

    // useObjectStreams:false gives a traditional xref table our encryptPdf can work with
    const pdfBytes   = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
    const finalBytes = (password && password.trim()) ? encryptPdf(pdfBytes, password.trim()) : pdfBytes;

    const safeName = (name||'AmbikaShelf').replace(/[^\w\-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeName + '.pdf"');
    res.setHeader('Content-Length', finalBytes.length);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end(finalBytes);

  } catch (err) {
    console.error('PDF error:', err.message);
    return res.status(500).json({ success:false, msg: err.message });
  }
});


app.use('/api/wallet', walletRoutes);             // ← MOVED DOWN ✅

// ---------- Sitemaps ----------
app.get("/sitemap.xml", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/sitemap.xml"));
});
app.get("/robots.txt", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/robots.txt"));
});

// ---------- FRONTEND ----------
app.use(express.static(path.join(__dirname, '../frontend')));

// ---------- MONGO CONNECTION ----------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB Error:', err));

// ---------- HELPERS ----------
function generateReferralCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const userMemory = {};

// ---------- ROUTES ----------
app.get('/signup', (req, res) => {
  const refCode = req.query.ref;
  if (refCode) res.cookie('ref', refCode, { maxAge: 7*24*60*60*1000 });
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/worldchat', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/worldchat.html'));
});

// ══════════════════════════════════════════
// WORLD CHAT — PUSH NOTIFICATIONS (@mentions)
// ══════════════════════════════════════════

// GET the public VAPID key so the frontend can subscribe to push
app.get('/api/notify/vapid-public-key', (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.json({ success: false, key: null, msg: 'VAPID keys not configured on server' });
  }
  res.json({ success: true, key: process.env.VAPID_PUBLIC_KEY });
});

// Save/refresh a device's push subscription + display name in MongoDB
app.post('/api/notify/subscribe', async (req, res) => {
  try {
    const { name, deviceId, subscription } = req.body;
    if (!name || !deviceId || !subscription || !subscription.endpoint) {
      return res.json({ success: false, msg: 'Missing name, deviceId or subscription' });
    }

    await NotificationSubscriber.findOneAndUpdate(
      { deviceId },
      {
        name: name.trim(),
        nameLower: name.trim().toLowerCase(),
        deviceId,
        subscription,
        userAgent: req.headers['user-agent'] || ''
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, msg: 'Notifications enabled' });
  } catch (err) {
    console.error('❌ /api/notify/subscribe:', err.message);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

// GET the list of registered names (used by the frontend to verify @mentions before highlighting them blue)
app.get('/api/notify/users', async (req, res) => {
  try {
    const names = await NotificationSubscriber.distinct('name');
    res.json({ success: true, users: names });
  } catch (err) {
    console.error('❌ /api/notify/users:', err.message);
    res.status(500).json({ success: false, users: [] });
  }
});

// ---------- SEND OTP ----------
app.post('/send-otp', async (req, res) => {
  try {
    const { name, email, refCode, password } = req.body;
    if (!name || !email)
      return res.json({ success: false, msg: "Name and email required" });

    const existing = await User.findOne({ email });
    if (existing) return res.json({ success: false, msg: "Email already registered" });

    const otp          = generateOTP();
    const otpExpires   = new Date(Date.now() + 5 * 60 * 1000);
    const referralCode = generateReferralCode();

    let referredBy = null;
    const cookieRef = req.cookies.ref;
    const finalRef  = refCode || cookieRef;
    if (finalRef) {
      const referrer = await User.findOne({ referralCode: finalRef });
      if (referrer) referredBy = referrer._id;
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    await User.create({
      name, email, referralCode, referredBy,
      otp, otpExpires,
      password: hashedPassword
    });

    return res.json({ success: true, msg: "OTP generated", otp });
  } catch (err) {
    console.error('❌ /send-otp:', err.message);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- VERIFY OTP ----------
app.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: "User not found" });

    if (user.otp !== otp || user.otpExpires < new Date()) {
      return res.json({ success: false, msg: "Invalid or expired OTP" });
    }

    user.otp = null;
    user.otpExpires = null;
    await user.save();

    if (user.referredBy) {
      await User.findByIdAndUpdate(user.referredBy, { $inc: { rewardBalance: 50 } });
      await Referral.create({
        referrerId: user.referredBy,
        refereeId: user._id,
        status: 'completed',
        rewardGranted: true
      });
    }

    try {
      await sendWelcomeMail({ email: user.email, username: user.name, name: user.name });
    } catch (emailError) {
      console.error('💥 WELCOME EMAIL ERROR:', emailError.message);
    }

    res.json({
      success: true,
      msg: "Signup successful!",
      referralCode: user.referralCode,
      rewardBalance: user.rewardBalance || 0
    });

  } catch (err) {
    console.error('❌ /verify-otp:', err.message);
    res.status(500).json({ success: false, msg: "Internal server error" });
  }
});

// ---------- LOGIN ----------
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: "No account found with this email" });

    if (!user.password)
      return res.json({ success: false, msg: "This account was created with Google. Please use Google login." });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, msg: "Incorrect password" });

    res.json({
      success:       true,
      name:          user.name,
      referralCode:  user.referralCode,
      rewardBalance: user.rewardBalance || 0
    });

  } catch (err) {
    console.error('❌ /login:', err.message);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- GOOGLE AUTH ----------
app.post('/google-auth', async (req, res) => {
  try {
    const { name, email, googleId, password, refCode } = req.body;

    let user = await User.findOne({ email });

    if (user) {
      if (!user.googleId) { user.googleId = googleId; await user.save(); }
      return res.json({
        success:       true,
        isNew:         false,
        name:          user.name,
        referralCode:  user.referralCode,
        rewardBalance: user.rewardBalance || 0
      });
    }

    if (!password) {
      return res.json({ success: true, isNew: true });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const referralCode   = generateReferralCode();

    let referredBy = null;
    if (refCode) {
      const referrer = await User.findOne({ referralCode: refCode });
      if (referrer) {
        referredBy = referrer._id;
        referrer.rewardBalance = (referrer.rewardBalance || 0) + 50;
        await referrer.save();
      }
    }

    user = await User.create({
      name, email, googleId, referralCode, referredBy,
      password: hashedPassword,
      rewardBalance: 0,
      otp: null, otpExpires: null
    });

    try {
      await sendWelcomeMail({ email: user.email, username: user.name, name: user.name });
    } catch (e) {
      console.error('💥 Welcome email error:', e.message);
    }

    return res.json({
      success:       true,
      isNew:         false,
      name:          user.name,
      referralCode:  user.referralCode,
      rewardBalance: 0
    });

  } catch (err) {
    console.error('❌ /google-auth:', err.message);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- FORGOT PASSWORD ----------
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: "No account found with this email" });

    const otp = generateOTP();
    user.otp        = otp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    res.json({ success: true, otp });
  } catch (err) {
    console.error('❌ /forgot-password:', err.message);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- RESET PASSWORD ----------
app.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email });

    if (!user)                        return res.json({ success: false, msg: "User not found" });
    if (user.otp !== otp)             return res.json({ success: false, msg: "Invalid OTP" });
    if (user.otpExpires < new Date()) return res.json({ success: false, msg: "OTP expired" });

    user.password   = await bcrypt.hash(newPassword, 10);
    user.otp        = null;
    user.otpExpires = null;
    await user.save();

    res.json({ success: true, msg: "Password reset successfully" });
  } catch (err) {
    console.error('❌ /reset-password:', err.message);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ---------- ASK AI ----------
console.log("Loaded Gemini Key:", process.env.GEMINI_API_KEY);

app.post("/ask-ai", async (req, res) => {
  const { text, image, username } = req.body;

  if (!userMemory[username]) userMemory[username] = [];

  try {
    let parts = [{ text: text || "Describe this image" }];

    if (image) {
      const match = image.match(/^data:(.*);base64/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: image.split(",")[1] } });
      }
    }

    userMemory[username].push({ role: "user", parts });
    if (userMemory[username].length > 5) userMemory[username].shift();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{
                text: `
You are AmbikaShelf AI.
User name is ${username}.
You are friendly, smart, slightly witty, and helpful.
You represent AmbikaShelf.shop — an online platform.

Rules:
- Always respond as AmbikaShelf.
- Keep answers short and clean.
- If user greets, greet warmly.
- If unsure, say politely you don't know.
- Use simple language.

Founder and CEO of AmbikaShelf is Anuj Chauhan.

Features of AmbikaShelf:
- Users can scan and create QR through: ambikashelf.shop/qr.html
- A world chatting platform including image and text input
- An AmbikaShelf AI chatbot (you)

More About Us:
AmbikaShelf Enterprises is a technology-driven organization founded and operated by Anuj Chauhan.
Customer Support: support@ambikashelf.shop
Business Partnerships: business@ambikashelf.shop
WhatsApp: +91 9125573750
`
              }]
            },
            ...userMemory[username]
          ]
        })
      }
    );

    const data = await response.json();
    console.log("Gemini Raw Response:", JSON.stringify(data, null, 2));

    if (data.error) return res.json({ reply: "Gemini API Error: " + data.error.message });

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Gemini returned empty response.";

    userMemory[username].push({ role: "model", parts: [{ text: reply }] });
    if (userMemory[username].length > 5) userMemory[username].shift();

    res.json({ reply });

  } catch (err) {
    console.error("AI Server Error:", err);
    res.json({ reply: "Server error while calling AI." });
  }
});

// ---------- CREATE HTTP SERVER ----------
const server = http.createServer(app);

// ---------- SOCKET.IO ----------
const io = new Server(server);
chatSocket(io);

// ---------- START SERVER ----------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
