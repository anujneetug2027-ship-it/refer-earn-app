function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  const n = Number(value);
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

function returnTone(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return {
      text: "#334155",
      bg: "#f8fbff",
      border: "#dbeafe",
      badgeBg: "#eff6ff"
    };
  }

  if (n > 0) {
    return {
      text: "#15803d",
      bg: "#f0fdf4",
      border: "#bbf7d0",
      badgeBg: "#dcfce7"
    };
  }

  if (n < 0) {
    return {
      text: "#dc2626",
      bg: "#fef2f2",
      border: "#fecaca",
      badgeBg: "#fee2e2"
    };
  }

  return {
    text: "#334155",
    bg: "#f8fbff",
    border: "#dbeafe",
    badgeBg: "#eff6ff"
  };
}

function assetCard(title, value, iconUrl, iconAlt) {
  const tone = returnTone(value);

  return `
    <td
      class="asset-cell"
      width="50%"
      style="width:50%;padding:6px;vertical-align:top;"
    >
      <table
        role="presentation"
        width="100%"
        cellpadding="0"
        cellspacing="0"
        border="0"
        style="
          border-collapse:separate;
          border-spacing:0;
          background:${tone.bg};
          border:1px solid ${tone.border};
          border-radius:16px;
        "
      >
        <tr>
          <td style="padding:16px 16px 14px;">

            <table
              role="presentation"
              cellpadding="0"
              cellspacing="0"
              border="0"
            >
              <tr>

                <td style="vertical-align:middle;padding-right:10px;">
                  <div style="
                    width:38px;
                    height:38px;
                    background:#ffffff;
                    border:1px solid #e2e8f0;
                    border-radius:11px;
                    text-align:center;
                    line-height:38px;
                  ">
                    <img
                      src="${esc(iconUrl)}"
                      alt="${esc(iconAlt)}"
                      width="28"
                      height="28"
                      style="
                        display:inline-block;
                        width:28px;
                        height:28px;
                        object-fit:contain;
                        vertical-align:middle;
                        border:0;
                      "
                    >
                  </div>
                </td>

                <td style="vertical-align:middle;">
                  <div style="
                    font-family:Arial,Helvetica,sans-serif;
                    font-size:13px;
                    line-height:18px;
                    color:#64748b;
                    font-weight:700;
                  ">
                    ${esc(title)}
                  </div>
                </td>

              </tr>
            </table>

            <div style="height:12px;line-height:12px;font-size:1px;">
              &nbsp;
            </div>

            <div style="
              font-family:Arial,Helvetica,sans-serif;
              font-size:22px;
              line-height:28px;
              font-weight:800;
              color:${tone.text};
            ">
              ${esc(fmtPct(value))}
            </div>

          </td>
        </tr>
      </table>
    </td>
  `;
}

function buildMonthlyReportEmail(data = {}) {

  const name = data.name || "there";
  const month = data.month || "";
  const year = data.year || "";

  const monthlyReturn = data.monthlyReturnPercent;

  const ar = data.assetReturns || {};

  const supportEmail =
    data.supportEmail || "support@ambikashelf.in";

  /*
    IMPORTANT:
    This template NEVER generates or stores the actual PDF password.

    The backend may optionally provide:
    passwordExample

    Example:
    ANUJ2008

    Otherwise only the password format is displayed.
  */

  const passwordHint =
    data.passwordHint ||
    "First 4 letters of your name in CAPITAL followed by your birth year.";

  const passwordExample =
    data.passwordExample || "";

  const currentYear =
    new Date().getFullYear();

  const snapshotTone =
    returnTone(monthlyReturn);

  return `
<!doctype html>

<html>

<head>

  <meta charset="utf-8">

  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >

  <meta
    name="color-scheme"
    content="light"
  >

  <meta
    name="supported-color-schemes"
    content="light"
  >

  <title>
    AmbikaShelf Portfolio Manager — Monthly Report
  </title>

  <style>

    @media screen and (max-width:620px) {

      .email-shell {
        width:100% !important;
      }

      .outer-pad {
        padding:12px 8px !important;
      }

      .main-pad {
        padding:24px 18px !important;
      }

      .hero-pad {
        padding:28px 20px !important;
      }

      .hero-title {
        font-size:28px !important;
        line-height:34px !important;
      }

      .asset-cell {
        display:block !important;
        width:100% !important;
      }

      .snapshot-number {
        font-size:36px !important;
        line-height:42px !important;
      }

    }

  </style>

</head>


<body style="
  margin:0;
  padding:0;
  background:#eef6ff;
  color:#0f172a;
  font-family:Arial,Helvetica,sans-serif;
">


  <!-- PREHEADER -->

  <div style="
    display:none;
    max-height:0;
    overflow:hidden;
    opacity:0;
    color:transparent;
  ">
    Your ${esc(month)} ${esc(year)}
    portfolio summary from
    AmbikaShelf Portfolio Manager.
  </div>


  <table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
      width:100%;
      background:#eef6ff;
    "
  >

    <tr>

      <td
        class="outer-pad"
        align="center"
        style="padding:28px 12px;"
      >


        <!-- MAIN CARD -->

        <table
          role="presentation"
          class="email-shell"
          width="640"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            width:100%;
            max-width:640px;
            background:#ffffff;
            border:1px solid #d9e8f8;
            border-radius:24px;
            overflow:hidden;
            box-shadow:
              0 12px 35px
              rgba(37,99,235,.10);
          "
        >


          <!-- HEADER -->

          <tr>

            <td
              class="hero-pad"
              style="
                padding:30px 34px;
                background:#0f8fe8;
              "
            >

              <div style="
                background:
                  linear-gradient(
                    135deg,
                    #0ea5e9 0%,
                    #2563eb 100%
                  );
              ">


                <!-- BRAND -->

                <table
                  role="presentation"
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                >

                  <tr>

                    <td>

                      <table
                        role="presentation"
                        cellpadding="0"
                        cellspacing="0"
                        border="0"
                      >

                        <tr>

                          <td
                            style="
                              vertical-align:middle;
                              padding-right:12px;
                            "
                          >

                            <div style="
                              width:50px;
                              height:50px;
                              background:#ffffff;
                              border-radius:15px;
                              text-align:center;
                              line-height:50px;
                            ">

                              <img
                                src="https://ambikashelf.in/icons/ambikashelf.png"
                                alt="AmbikaShelf"
                                width="42"
                                height="42"
                                style="
                                  display:inline-block;
                                  width:42px;
                                  height:42px;
                                  object-fit:contain;
                                  vertical-align:middle;
                                  border:0;
                                "
                              >

                            </div>

                          </td>


                          <td
                            style="
                              vertical-align:middle;
                            "
                          >

                            <div style="
                              font-size:18px;
                              line-height:22px;
                              font-weight:800;
                              color:#ffffff;
                            ">
                              AmbikaShelf
                            </div>

                            <div style="
                              font-size:12px;
                              line-height:18px;
                              font-weight:600;
                              color:#dbeafe;
                              letter-spacing:.3px;
                            ">
                              Portfolio Manager
                            </div>

                          </td>

                        </tr>

                      </table>

                    </td>

                  </tr>

                </table>


                <div style="
                  height:28px;
                  line-height:28px;
                  font-size:1px;
                ">
                  &nbsp;
                </div>


                <!-- HERO TITLE -->

                <div
                  class="hero-title"
                  style="
                    font-size:34px;
                    line-height:40px;
                    font-weight:800;
                    letter-spacing:-.7px;
                    color:#ffffff;
                  "
                >
                  Your Monthly<br>
                  Portfolio Summary
                </div>


                <div style="
                  height:10px;
                  line-height:10px;
                  font-size:1px;
                ">
                  &nbsp;
                </div>


                <div style="
                  font-size:14px;
                  line-height:22px;
                  color:#e0f2fe;
                ">
                  ${esc(month)}
                  ${esc(year)}
                  &nbsp;•&nbsp;
                  Wealth Management
                </div>


              </div>

            </td>

          </tr>


          <!-- CONTENT -->

          <tr>

            <td
              class="main-pad"
              style="
                padding:32px 34px;
                background:#ffffff;
              "
            >


              <!-- GREETING -->

              <div style="
                font-size:24px;
                line-height:30px;
                font-weight:800;
                color:#0f172a;
              ">
                Hey, ${esc(name)}
              </div>


              <div style="
                height:8px;
                line-height:8px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                font-size:15px;
                line-height:25px;
                color:#64748b;
              ">
                Here is your portfolio summary report
                for the month of
                <strong style="color:#334155;">
                  ${esc(month)}
                </strong>.
              </div>


              <div style="
                height:4px;
                line-height:4px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                font-size:15px;
                line-height:25px;
                color:#64748b;
              ">
                Your detailed report is attached with
                this email.
              </div>


              <div style="
                height:28px;
                line-height:28px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <!-- MONTH END SNAPSHOT -->

              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="
                  border-collapse:separate;
                  border-spacing:0;
                  background:#f5faff;
                  border:1px solid #cfe3f8;
                  border-radius:20px;
                "
              >

                <tr>

                  <td style="padding:24px;">


                    <table
                      role="presentation"
                      width="100%"
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                    >

                      <tr>

                        <td
                          style="
                            vertical-align:top;
                          "
                        >

                          <div style="
                            font-size:13px;
                            line-height:18px;
                            color:#64748b;
                            font-weight:800;
                            letter-spacing:.7px;
                            text-transform:uppercase;
                          ">
                            💼 Month-End Snapshot
                          </div>


                          <div style="
                            height:9px;
                            line-height:9px;
                            font-size:1px;
                          ">
                            &nbsp;
                          </div>


                          <div style="
                            font-size:13px;
                            line-height:20px;
                            color:#64748b;
                          ">
                            Total Returns This Month
                          </div>

                        </td>


                        <td
                          align="right"
                          valign="top"
                        >

                          <div style="
                            display:inline-block;
                            padding:7px 10px;
                            border-radius:999px;
                            background:${snapshotTone.badgeBg};
                            color:${snapshotTone.text};
                            font-size:11px;
                            line-height:15px;
                            font-weight:800;
                          ">
                            ${esc(month)}
                            ${esc(year)}
                          </div>

                        </td>

                      </tr>

                    </table>


                    <div style="
                      height:8px;
                      line-height:8px;
                      font-size:1px;
                    ">
                      &nbsp;
                    </div>


                    <div
                      class="snapshot-number"
                      style="
                        font-size:42px;
                        line-height:48px;
                        font-weight:900;
                        letter-spacing:-1px;
                        color:${snapshotTone.text};
                      "
                    >
                      ${esc(fmtPct(monthlyReturn))}
                    </div>


                  </td>

                </tr>

              </table>


              <div style="
                height:28px;
                line-height:28px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <!-- ASSET PERFORMANCE -->

              <div style="
                font-size:17px;
                line-height:24px;
                font-weight:800;
                color:#0f172a;
              ">
                Asset Performance
              </div>


              <div style="
                height:5px;
                line-height:5px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                font-size:13px;
                line-height:20px;
                color:#64748b;
              ">
                Monthly performance across your tracked assets.
              </div>


              <div style="
                height:12px;
                line-height:12px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="
                  border-collapse:separate;
                  border-spacing:0;
                "
              >

                <tr>

                  ${assetCard(
                    "Stocks",
                    ar.stocks,
                    "https://ambikashelf.in/icons/stock.png",
                    "Stocks"
                  )}

                  ${assetCard(
                    "Crypto",
                    ar.crypto,
                    "https://ambikashelf.in/icons/crypto.png",
                    "Crypto"
                  )}

                </tr>


                <tr>

                  ${assetCard(
                    "Mutual Funds",
                    ar.mutualFunds,
                    "https://ambikashelf.in/icons/mf.png",
                    "Mutual Funds"
                  )}

                  ${assetCard(
                    "Utility",
                    ar.utility,
                    "https://ambikashelf.in/icons/utility.png",
                    "Utility"
                  )}

                </tr>

              </table>


              <div style="
                height:28px;
                line-height:28px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <!-- SECURITY -->

              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="
                  border-collapse:separate;
                  border-spacing:0;
                  background:#f8fbff;
                  border:1px solid #cfe3f8;
                  border-radius:18px;
                "
              >

                <tr>

                  <td style="
                    padding:22px;
                  ">


                    <div style="
                      font-size:17px;
                      line-height:24px;
                      font-weight:800;
                      color:#0f172a;
                    ">
                      🔒 Security Notice
                    </div>


                    <div style="
                      height:7px;
                      line-height:7px;
                      font-size:1px;
                    ">
                      &nbsp;
                    </div>


                    <div style="
                      font-size:13px;
                      line-height:21px;
                      color:#64748b;
                    ">
                      For your financial privacy,
                      the attached PDF is securely
                      password-protected.
                    </div>


                    <div style="
                      height:16px;
                      line-height:16px;
                      font-size:1px;
                    ">
                      &nbsp;
                    </div>


                    <div style="
                      background:#ffffff;
                      border:1px solid #dbeafe;
                      border-radius:13px;
                      padding:14px 15px;
                    ">


                      <div style="
                        font-size:13px;
                        line-height:19px;
                        color:#64748b;
                        font-weight:700;
                      ">
                        🔑 Your PDF Password
                      </div>


                      <div style="
                        height:5px;
                        line-height:5px;
                        font-size:1px;
                      ">
                        &nbsp;
                      </div>


                      <div style="
                        font-size:14px;
                        line-height:22px;
                        color:#334155;
                        font-weight:700;
                      ">
                        ${esc(passwordHint)}
                      </div>


                      ${
                        passwordExample
                          ? `
                            <div style="
                              height:9px;
                              line-height:9px;
                              font-size:1px;
                            ">
                              &nbsp;
                            </div>

                            <div style="
                              display:inline-block;
                              background:#eff6ff;
                              border:1px solid #bfdbfe;
                              border-radius:9px;
                              padding:8px 11px;
                              color:#1d4ed8;
                              font-family:Arial,Helvetica,sans-serif;
                              font-size:14px;
                              line-height:18px;
                              font-weight:800;
                              letter-spacing:.5px;
                            ">
                              Example:
                              ${esc(passwordExample)}
                            </div>
                          `
                          : ""
                      }


                    </div>


                  </td>

                </tr>

              </table>


              <div style="
                height:30px;
                line-height:30px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <!-- CLOSING -->

              <div style="
                font-size:15px;
                line-height:25px;
                color:#475569;
              ">
                Thank you for trusting
                <strong style="color:#2563eb;">
                  AmbikaShelf
                </strong>
                to manage your wealth.
              </div>


              <div style="
                height:20px;
                line-height:20px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                font-size:14px;
                line-height:22px;
                color:#64748b;
              ">
                Best Regards,
              </div>


              <div style="
                height:3px;
                line-height:3px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                font-size:15px;
                line-height:22px;
                font-weight:800;
                color:#0f172a;
              ">
                AmbikaShelf Wealth Management
              </div>


              <div style="
                height:24px;
                line-height:24px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                height:1px;
                background:#e2e8f0;
                line-height:1px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                height:18px;
                line-height:18px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <!-- NO REPLY -->

              <div style="
                font-size:12px;
                line-height:20px;
                color:#94a3b8;
              ">
                Do not reply to this email.
                If you have any concerns, mail us at

                <a
                  href="mailto:${esc(supportEmail)}"
                  style="
                    color:#2563eb;
                    text-decoration:none;
                    font-weight:700;
                  "
                >
                  ${esc(supportEmail)}
                </a>.
              </div>


            </td>

          </tr>


          <!-- FOOTER -->

          <tr>

            <td style="
              padding:24px 30px;
              background:#f3f8fe;
              border-top:1px solid #dbeafe;
              text-align:center;
            ">


              <img
                src="https://ambikashelf.in/icons/ambikashelf.png"
                alt="AmbikaShelf"
                width="38"
                height="38"
                style="
                  display:inline-block;
                  width:38px;
                  height:38px;
                  object-fit:contain;
                  border:0;
                  vertical-align:middle;
                "
              >


              <div style="
                height:8px;
                line-height:8px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                font-size:14px;
                line-height:20px;
                font-weight:800;
                color:#1e3a5f;
              ">
                AmbikaShelf Portfolio Manager
              </div>


              <div style="
                height:4px;
                line-height:4px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                font-size:12px;
                line-height:19px;
                color:#94a3b8;
              ">
                Professional wealth tracking, simplified.
              </div>


              <div style="
                height:12px;
                line-height:12px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                font-size:11px;
                line-height:18px;
                color:#94a3b8;
              ">
                This is an automated monthly portfolio report.
              </div>


              <div style="
                height:6px;
                line-height:6px;
                font-size:1px;
              ">
                &nbsp;
              </div>


              <div style="
                font-size:11px;
                line-height:18px;
                color:#a1afbf;
              ">
                © ${currentYear}
                AmbikaShelf.
                All rights reserved.
              </div>


            </td>

          </tr>


        </table>


      </td>

    </tr>

  </table>


</body>

</html>
`;
}

module.exports = {
  buildMonthlyReportEmail
};
