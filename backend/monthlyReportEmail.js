/**
 * AmbikaShelf Portfolio Manager - Monthly Report Email
 * Based on the supplied AmbikaShelf email template.
 *
 * Expected data:
 * {
 *   name,
 *   month,
 *   year,                 // optional
 *   monthlyReturnPercent, // e.g. +5.82% or -2.14%
 *   monthlyReturnColor,   // optional; auto-selected when omitted
 *   currentYear,          // optional
 *   supportEmail          // optional
 * }
 *
 * This module does not generate or store PDF passwords.
 */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getReturnColor(value) {
  const n = Number(String(value ?? "").replace("%", "").replace("+", ""));
  if (Number.isFinite(n) && n > 0) return "#168a52";
  if (Number.isFinite(n) && n < 0) return "#dc3545";
  return "#163c35";
}

function buildMonthlyReportEmail(data = {}) {
  const name = esc(data.name || "there");
  const month = esc(data.month || "");
  const monthlyReturnPercent = esc(data.monthlyReturnPercent ?? "0.00%");
  const monthlyReturnColor = esc(data.monthlyReturnColor || getReturnColor(data.monthlyReturnPercent));
  const currentYear = esc(data.currentYear || new Date().getFullYear());
  const supportEmail = esc(data.supportEmail || "support@ambikashelf.in");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>AmbikaShelf Portfolio Manager</title>
<!--[if mso]><style>table{border-collapse:collapse!important}td{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
<style>
html,body{margin:0!important;padding:0!important;width:100%!important;background:#eaf5ff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
body{font-family:Arial,Helvetica,sans-serif}table{border-spacing:0;border-collapse:collapse}td{border-collapse:collapse}img{border:0;outline:none;text-decoration:none;display:block;max-width:100%;height:auto}a{text-decoration:none}.wrapper{width:100%;background:#eaf5ff}.container{width:100%;max-width:660px;margin:0 auto}
.hero-title{font-family:Georgia,"Times New Roman",serif;font-size:39px;line-height:40px;font-weight:700;letter-spacing:-1.4px}.section-title{font-family:Georgia,"Times New Roman",serif;font-size:21px;line-height:28px;font-weight:700}.body-text{font-size:14px;line-height:24px}.snapshot-return{font-size:33px;line-height:40px;font-weight:800}.asset-title{font-size:13px;line-height:18px;font-weight:700}.asset-text{font-size:11px;line-height:17px}
@media screen and (max-width:680px){.container{width:100%!important}.mobile-padding{padding-left:20px!important;padding-right:20px!important}.hero-title{font-size:34px!important;line-height:36px!important}.snapshot-return{font-size:28px!important}.stack{display:block!important;width:100%!important}.stack-padding{padding-bottom:10px!important}.mobile-center{text-align:center!important}}
</style>
</head>
<body>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="wrapper"><tr><td align="center" style="padding:16px 8px 35px">
<table role="presentation" width="660" cellpadding="0" cellspacing="0" border="0" class="container" style="width:100%;max-width:660px">

<!-- HEADER -->
<tr><td style="background:#062b59;background:linear-gradient(135deg,#041d3d 0%,#063d78 55%,#0874c9 100%);border-radius:22px 22px 0 0;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="mobile-padding" style="padding:22px 32px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="left"><a href="https://ambikashelf.in" target="_blank"><img src="https://ambikashelf.in/icons/ambikashelf.png" alt="AmbikaShelf" width="145" style="width:145px;max-width:145px"></a></td>
<td align="right" style="color:#c8e4fa;font-size:10px;line-height:15px;letter-spacing:.8px;text-transform:uppercase">Your Wealth<br><strong style="color:#fff">Our Priority</strong></td>
</tr></table></td></tr>
<tr><td class="mobile-padding" style="padding:22px 32px 10px"><div class="hero-title" style="color:#fff">Portfolio<br>Manager</div><div style="color:#b9ddff;font-size:13px;line-height:20px;margin-top:9px">Smarter insights for a brighter tomorrow.</div></td></tr>
<tr><td align="right" style="padding:2px 18px 0"><img src="https://ambikashelf.in/icons/growth.png" alt="Portfolio Growth" width="380" style="width:380px;max-width:80%;margin-left:auto"></td></tr>
<tr><td class="mobile-padding" style="padding:3px 24px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="33.33%" align="center" style="color:#fff;padding:5px"><div style="font-size:19px;line-height:24px">◈</div><div style="font-size:11px;font-weight:bold">Track</div><div style="color:#a9d6ff;font-size:9px">Your Investments</div></td>
<td width="33.33%" align="center" style="color:#fff;padding:5px"><div style="font-size:19px;line-height:24px">◎</div><div style="font-size:11px;font-weight:bold">Analyse</div><div style="color:#a9d6ff;font-size:9px">Your Growth</div></td>
<td width="33.33%" align="center" style="color:#fff;padding:5px"><div style="font-size:19px;line-height:24px">◇</div><div style="font-size:11px;font-weight:bold">Build</div><div style="color:#a9d6ff;font-size:9px">A Secure Future</div></td>
</tr></table></td></tr></table></td></tr>

<!-- CONTENT -->
<tr><td style="background:#f4faff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="mobile-padding" style="padding:32px 34px 20px">
<div style="color:#092d5c;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:34px;font-weight:bold">Hey, ${name} 👋</div>
<div class="body-text" style="color:#395a7d;margin-top:13px">Here is your portfolio summary report for the month of <strong style="color:#092d5c">${month}</strong>.</div>
<div class="body-text" style="color:#395a7d;margin-top:6px">Your detailed report is attached with this email.</div>
</td></tr></table>

<!-- SNAPSHOT -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="mobile-padding" style="padding:7px 20px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #d9ebfa;border-radius:20px"><tr><td style="padding:25px 23px 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="55" valign="top"><div style="width:46px;height:46px;line-height:46px;text-align:center;background:#e5f4ff;border-radius:50%;font-size:22px">📊</div></td><td valign="middle" style="padding-left:10px"><div class="section-title" style="color:#092d5c">Month-End Snapshot</div><div style="color:#6683a0;font-size:11px;line-height:17px;margin-top:2px">Your portfolio performance this month</div></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;background:#ecfbf4;border:1px solid #bfead4;border-radius:16px"><tr><td style="padding:23px 20px 20px"><div style="color:#163c35;font-size:13px;line-height:19px;font-weight:bold">Total Returns This Month</div><div class="snapshot-return" style="color:${monthlyReturnColor};font-family:Arial,Helvetica,sans-serif;margin-top:3px">${monthlyReturnPercent}</div><img src="https://ambikashelf.in/icons/chart.png" alt="" width="500" style="width:100%;max-width:500px;margin-top:10px"></td></tr></table>
<div style="text-align:center;color:#6a88a5;font-size:11px;font-style:italic;margin-top:15px">📈 Consistent progress towards your bigger goals.</div>
</td></tr></table></td></tr></table>

<!-- ASSETS -->
<tr><td class="mobile-padding" style="padding:5px 20px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #dcecf9;border-radius:20px"><tr><td style="padding:25px 22px 23px">
<div class="section-title" style="color:#092d5c">Building Wealth, Together</div><div style="color:#6986a1;font-size:11px;line-height:18px;margin-top:3px">A complete view of your investments in one place.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:17px">
<tr>
<td width="50%" class="stack stack-padding" valign="top" style="padding:5px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef8ff;border-radius:13px"><tr><td align="center" style="padding:17px 8px"><img src="https://ambikashelf.in/icons/mf.png" alt="Mutual Funds" width="38" style="width:38px;margin:auto"><div class="asset-title" style="color:#12375f;margin-top:8px">Mutual Funds</div><div class="asset-text" style="color:#6b89a5;margin-top:2px">Long-term growth</div></td></tr></table></td>
<td width="50%" class="stack stack-padding" valign="top" style="padding:5px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef8ff;border-radius:13px"><tr><td align="center" style="padding:17px 8px"><img src="https://ambikashelf.in/icons/stock.png" alt="Stocks" width="38" style="width:38px;margin:auto"><div class="asset-title" style="color:#12375f;margin-top:8px">Stocks &amp; ETFs</div><div class="asset-text" style="color:#6b89a5;margin-top:2px">Fuel your ambitions</div></td></tr></table></td>
</tr><tr>
<td width="50%" class="stack stack-padding" valign="top" style="padding:5px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef8ff;border-radius:13px"><tr><td align="center" style="padding:17px 8px"><img src="https://ambikashelf.in/icons/crypto.png" alt="Cryptocurrency" width="38" style="width:38px;margin:auto"><div class="asset-title" style="color:#12375f;margin-top:8px">Cryptocurrency</div><div class="asset-text" style="color:#6b89a5;margin-top:2px">Invest in innovation</div></td></tr></table></td>
<td width="50%" class="stack stack-padding" valign="top" style="padding:5px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef8ff;border-radius:13px"><tr><td align="center" style="padding:17px 8px"><img src="https://ambikashelf.in/icons/utility.png" alt="Gold" width="38" style="width:38px;margin:auto"><div class="asset-title" style="color:#12375f;margin-top:8px">Gold &amp; Silver</div><div class="asset-text" style="color:#6b89a5;margin-top:2px">A hedge for tomorrow</div></td></tr></table></td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px"><tr><td style="background:#e4f3ff;border-radius:13px;padding:15px 17px;text-align:center"><div style="color:#317bbd;font-family:Georgia,'Times New Roman',serif;font-size:13px;line-height:21px;font-style:italic">“Investing is not about timing the market, but time in the market.”</div></td></tr></table>
</td></tr></table></td></tr>

<!-- JOURNEY -->
<tr><td class="mobile-padding" style="padding:3px 20px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:20px;border:1px solid #dcecf9"><tr><td style="padding:23px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="52" valign="top"><div style="width:43px;height:43px;border-radius:50%;background:#e6f5ff;text-align:center;line-height:43px;font-size:21px">✦</div></td><td style="padding-left:10px"><div style="color:#092d5c;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:27px;font-weight:bold">Your Financial Journey Continues</div><div style="color:#6b88a4;font-size:11px;line-height:18px;margin-top:3px">Small steps today. Bigger possibilities tomorrow.</div></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:15px"><tr>
<td width="50%" style="padding:4px"><div style="background:#f0f8ff;border-radius:11px;padding:13px"><strong style="color:#113961;font-size:12px">📊 Stay Informed</strong><div style="color:#708ca6;font-size:10px;line-height:16px;margin-top:3px">Make data-driven decisions</div></div></td>
<td width="50%" style="padding:4px"><div style="background:#f0f8ff;border-radius:11px;padding:13px"><strong style="color:#113961;font-size:12px">🛡️ Invest with Confidence</strong><div style="color:#708ca6;font-size:10px;line-height:16px;margin-top:3px">Your security is our priority</div></div></td>
</tr><tr>
<td width="50%" style="padding:4px"><div style="background:#f0f8ff;border-radius:11px;padding:13px"><strong style="color:#113961;font-size:12px">🌱 Grow Consistently</strong><div style="color:#708ca6;font-size:10px;line-height:16px;margin-top:3px">Small steps, big results</div></div></td>
<td width="50%" style="padding:4px"><div style="background:#f0f8ff;border-radius:11px;padding:13px"><strong style="color:#113961;font-size:12px">🎯 Plan for Tomorrow</strong><div style="color:#708ca6;font-size:10px;line-height:16px;margin-top:3px">A brighter, stronger future</div></div></td>
</tr></table>
</td></tr></table></td></tr>

<!-- MOUNTAIN -->
<tr><td class="mobile-padding" style="padding:3px 20px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#063b73;background:linear-gradient(110deg,#03244b,#0870c5);border-radius:17px;overflow:hidden"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:22px 20px" valign="middle"><div style="color:#fff;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:25px;font-weight:bold">Smarter Investments<br>for a Brighter Tomorrow</div><div style="color:#b7dcfb;font-size:10px;margin-top:7px">Track &nbsp;·&nbsp; Analyse &nbsp;·&nbsp; Grow</div></td><td width="42%" valign="bottom" align="right"><img src="https://ambikashelf.in/icons/mountain.png" alt="" width="210" style="width:210px;max-width:100%"></td></tr></table></td></tr></table></td></tr>

<!-- SECURITY -->
<tr><td class="mobile-padding" style="padding:2px 20px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffaf0;border:1px solid #f3dca7;border-radius:18px"><tr><td style="padding:23px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="51" valign="top"><div style="width:42px;height:42px;border-radius:50%;background:#fff0ce;text-align:center;line-height:42px;font-size:20px">🔒</div></td><td style="padding-left:10px"><div style="color:#162c43;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:26px;font-weight:bold">Security Notice</div><div style="color:#5d6873;font-size:12px;line-height:19px;margin-top:4px">For your financial privacy, the attached PDF is securely password-protected.</div></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border:1px solid #e9c56d;border-radius:13px;background:#fffdf7"><tr><td style="padding:18px"><div style="color:#b66b00;font-size:15px;font-weight:bold">🔑 Your PDF Password</div><div style="color:#26384b;font-size:12px;line-height:20px;margin-top:7px">For names containing 4 or more letters: use the first 4 letters of the name in CAPITAL followed by the birth year.</div><div style="color:#26384b;font-size:12px;line-height:20px;margin-top:4px">For names shorter than 4 letters: use the complete name in CAPITAL followed by the birth year.</div><div style="margin-top:11px;padding:10px 13px;background:#eef5fb;border-radius:8px;color:#092d5c;font-size:14px;font-weight:bold">Example: ANUJ2008</div></td></tr></table>
<div style="color:#71808f;font-size:10px;line-height:16px;margin-top:10px;text-align:center">🔐 Please do not share your PDF password with anyone.</div>
</td></tr></table></td></tr>

<!-- ATTACHMENT -->
<tr><td class="mobile-padding" style="padding:2px 20px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #dcecf9;border-radius:18px"><tr><td style="padding:23px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="51" valign="top"><div style="width:42px;height:42px;border-radius:50%;background:#e7f5ff;text-align:center;line-height:42px;font-size:20px">📄</div></td><td style="padding-left:10px"><div style="color:#092d5c;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:26px;font-weight:bold">What's Inside the Attachment?</div><div style="color:#6d89a3;font-size:11px;line-height:18px;margin-top:3px">Your detailed portfolio report includes:</div></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:13px"><tr><td style="padding:5px 0;color:#274a6d;font-size:11px"><span style="color:#1684d5;font-weight:bold">✓</span> Complete asset-wise performance</td></tr><tr><td style="padding:5px 0;color:#274a6d;font-size:11px"><span style="color:#1684d5;font-weight:bold">✓</span> Monthly and overall returns</td></tr><tr><td style="padding:5px 0;color:#274a6d;font-size:11px"><span style="color:#1684d5;font-weight:bold">✓</span> Historical trends and charts</td></tr><tr><td style="padding:5px 0;color:#274a6d;font-size:11px"><span style="color:#1684d5;font-weight:bold">✓</span> Insights and personalised suggestions</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px"><tr><td style="background:#eaf6ff;border-radius:13px;padding:17px"><div style="color:#123d65;font-size:11px;line-height:19px"><strong>Privacy &amp; Important Information</strong><br>Your data is treated with strict confidentiality and is used only for providing your portfolio services.<br>We care about your privacy, which is why your portfolio PDF has been securely password-protected.<br>Please do not share this PDF or your password with anyone unless absolutely necessary.<br>The information contained in the report is prepared for your personal portfolio reference.<br>Please review all figures and details carefully and contact us if you notice any discrepancy.<br>AmbikaShelf does not ask you to share your PDF password through email, messages or calls.<br>If you receive this report by mistake or it is not intended for you, please do not open or distribute it.<br>Kindly delete the email and report the issue to us at <strong>${supportEmail}</strong>.<br>For complete information, please review our <a href="https://ambikashelf.in/terms.html" target="_blank" style="color:#086ac3;font-weight:bold">Terms &amp; Conditions</a> and <a href="https://ambikashelf.in/privacy.html" target="_blank" style="color:#086ac3;font-weight:bold">Privacy Policy</a>.<br>We are committed to maintaining a secure, transparent and trustworthy portfolio experience.</div></td></tr></table>
</td></tr></table></td></tr>

<!-- CLOSING -->
<tr><td class="mobile-padding" style="padding:6px 34px 22px"><div style="color:#12385e;font-size:13px;line-height:22px">Thank you for trusting <strong>AmbikaShelf</strong> to manage your wealth.</div><div style="color:#385a78;font-size:13px;line-height:21px;margin-top:18px">Best Regards,</div><div style="color:#0865bd;font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:bold;margin-top:2px">AmbikaShelf Wealth Management</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="right" style="padding-top:3px"><img src="https://ambikashelf.in/icons/signature.png" alt="Signature" width="130" style="width:130px;max-width:130px;margin-left:auto"></td></tr></table><div style="width:42px;height:3px;background:#1385d4;margin-top:-7px"></div></td></tr>

<!-- FOOTER -->
<tr><td style="background:#032750;border-radius:0 0 22px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="mobile-padding" style="padding:28px 34px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle"><a href="https://ambikashelf.in" target="_blank"><img src="https://ambikashelf.in/icons/ambikashelf.png" alt="AmbikaShelf" width="125" style="width:125px;max-width:125px"></a><div style="color:#8fbce0;font-size:10px;margin-top:7px">Portfolio Manager</div><div style="color:#6d9cc4;font-size:9px;margin-top:4px">Learn · Track · Grow</div></td><td align="right" valign="middle"><a href="https://instagram.com/ambikashelf" target="_blank" style="display:inline-block;width:28px;height:28px;line-height:28px;border:1px solid #4d789e;border-radius:50%;text-align:center;color:#fff;font-size:12px;margin-left:4px">◎</a><a href="https://linkedin.com/ambikashelf" target="_blank" style="display:inline-block;width:28px;height:28px;line-height:28px;border:1px solid #4d789e;border-radius:50%;text-align:center;color:#fff;font-size:11px;margin-left:4px">in</a></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr><td style="height:1px;background:#28527a;font-size:1px;line-height:1px">&nbsp;</td></tr></table>
<div style="margin-top:17px;font-size:10px;line-height:19px"><a href="mailto:${supportEmail}" style="color:#b9dcf7">Support</a><span style="color:#527796">&nbsp;&nbsp;|&nbsp;&nbsp;</span><a href="https://ambikashelf.in/privacy.html" target="_blank" style="color:#b9dcf7">Privacy Policy</a><span style="color:#527796">&nbsp;&nbsp;|&nbsp;&nbsp;</span><a href="https://ambikashelf.in/terms.html" target="_blank" style="color:#b9dcf7">Terms of Service</a></div>
<div style="color:#7da4c5;font-size:9px;line-height:17px;margin-top:12px">© ${currentYear} AmbikaShelf. All rights reserved.</div><div style="color:#7da4c5;font-size:9px;line-height:17px">This is an automated monthly portfolio report.</div><div style="color:#8fb1cb;font-size:9px;line-height:16px;margin-top:14px">Do not reply to this email, if you have any concerns mail us at <a href="mailto:${supportEmail}" style="color:#fff;text-decoration:underline;font-weight:bold">${supportEmail}</a></div><div style="text-align:right;color:#477596;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:20px;font-style:italic;margin-top:15px">Invest.<br>Learn.<br>Grow.</div>
</td></tr></table></td></tr>

</table></td></tr></table></body></html>`;
}

module.exports = { buildMonthlyReportEmail };
