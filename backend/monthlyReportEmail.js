function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtPct(value) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {
    return "—";
  }

  const n = Number(value);
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

function assetCard(title, value, icon) {
  return `
    <div style="
      flex:1;
      min-width:180px;
      background:#f8fbff;
      border:1px solid #dbeafe;
      border-radius:14px;
      padding:16px;
    ">
      <div style="
        font-size:13px;
        color:#64748b;
        font-weight:600;
        margin-bottom:8px;
      ">
        ${icon} ${esc(title)}
      </div>

      <div style="
        font-size:22px;
        font-weight:700;
        color:#0f172a;
      ">
        ${esc(fmtPct(value))}
      </div>
    </div>
  `;
}

function buildMonthlyReportEmail(data = {}) {
  const name = data.name || "there";
  const month = data.month || "";
  const year = data.year || "";

  const monthlyReturn = data.monthlyReturnPercent;

  const ar = data.assetReturns || {};

  const passwordHint =
    data.passwordHint ||
    "First 4 letters of your name (uppercase) + birth year";

  const supportEmail =
    data.supportEmail || "support@ambikashelf.in";

  return `
<!doctype html>

<html>

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>
AmbikaShelf Monthly Portfolio Report
</title>

</head>

<body style="
  margin:0;
  background:#f1f7ff;
  font-family:Arial,Helvetica,sans-serif;
  color:#0f172a;
">

  <div style="
    max-width:680px;
    margin:0 auto;
    padding:24px 12px;
  ">

    <div style="
      background:#ffffff;
      border:1px solid #dbeafe;
      border-radius:20px;
      overflow:hidden;
      box-shadow:0 8px 30px rgba(15,23,42,.06);
    ">

      <!-- HEADER -->

      <div style="
        background:linear-gradient(135deg,#0ea5e9,#2563eb);
        padding:28px 24px;
        color:#fff;
      ">

        <img
          src="https://ambikashelf.in/icons/ambikashelf.png"
          alt="AmbikaShelf"
          style="
            width:46px;
            height:46px;
            border-radius:12px;
            background:#fff;
            padding:5px;
            object-fit:contain;
          "
        >

        <h1 style="
          margin:18px 0 6px;
          font-size:25px;
        ">
          Your Monthly Portfolio Report
        </h1>

        <div style="
          font-size:14px;
          opacity:.92;
        ">
          ${esc(month)} ${esc(year)}
          • AmbikaShelf Portfolio Manager
        </div>

      </div>


      <!-- BODY -->

      <div style="padding:26px 24px;">

        <p style="
          font-size:16px;
          margin:0 0 12px;
        ">
          Hi <strong>${esc(name)}</strong>,
        </p>


        <p style="
          font-size:14px;
          line-height:1.65;
          color:#475569;
          margin:0 0 22px;
        ">
          Your AmbikaShelf monthly portfolio report is
          attached to this email. It contains your portfolio
          snapshot and performance details for the reported month.
        </p>


        <!-- MONTHLY RETURN -->

        <div style="
          background:#eff6ff;
          border:1px solid #bfdbfe;
          border-radius:15px;
          padding:18px;
          margin-bottom:22px;
        ">

          <div style="
            font-size:12px;
            text-transform:uppercase;
            letter-spacing:.08em;
            color:#64748b;
            font-weight:700;
          ">
            Month-end snapshot
          </div>

          <div style="
            font-size:30px;
            font-weight:800;
            margin-top:6px;
            color:#0f172a;
          ">
            ${esc(fmtPct(monthlyReturn))}
          </div>

          <div style="
            font-size:13px;
            color:#64748b;
            margin-top:3px;
          ">
            Portfolio return for
            ${esc(month)} ${esc(year)}
          </div>

        </div>


        <!-- ASSET RETURNS -->

        <div style="
          display:flex;
          flex-wrap:wrap;
          gap:10px;
          margin-bottom:24px;
        ">

          ${assetCard(
            "Stocks",
            ar.stocks,
            "📈"
          )}

          ${assetCard(
            "Crypto",
            ar.crypto,
            "₿"
          )}

          ${assetCard(
            "Mutual Funds",
            ar.mutualFunds,
            "📊"
          )}

          ${assetCard(
            "Utility",
            ar.utility,
            "🪙"
          )}

        </div>


        <!-- SECURITY -->

        <div style="
          background:#fff7ed;
          border:1px solid #fed7aa;
          border-radius:14px;
          padding:17px;
          margin-bottom:22px;
        ">

          <div style="
            font-weight:700;
            color:#9a3412;
            margin-bottom:7px;
          ">
            🔐 Your PDF is password protected
          </div>

          <div style="
            font-size:13px;
            line-height:1.6;
            color:#7c2d12;
          ">
            Password format:
            <strong>${esc(passwordHint)}</strong>
          </div>

          <div style="
            font-size:12px;
            line-height:1.55;
            color:#9a3412;
            margin-top:7px;
          ">
            The password is generated from the personal
            details you provided to AmbikaShelf.
            Keep your report and password secure.
          </div>

        </div>


        <!-- SUPPORT -->

        <p style="
          font-size:13px;
          line-height:1.6;
          color:#64748b;
          margin:0;
        ">

          If you did not expect this report or need help,
          contact

          <a
            href="mailto:${esc(supportEmail)}"
            style="
              color:#2563eb;
              text-decoration:none;
            "
          >
            ${esc(supportEmail)}
          </a>.

        </p>

      </div>


      <!-- FOOTER -->

      <div style="
        border-top:1px solid #e2e8f0;
        padding:18px 24px;
        background:#f8fafc;
        text-align:center;
      ">

        <div style="
          font-size:12px;
          color:#64748b;
        ">
          © ${new Date().getFullYear()}
          AmbikaShelf • Portfolio Manager
        </div>

      </div>

    </div>

  </div>

</body>

</html>
`;
}

module.exports = {
  buildMonthlyReportEmail
};
