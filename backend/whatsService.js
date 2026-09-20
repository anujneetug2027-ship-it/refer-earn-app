const fetch = require("node-fetch");

const FAST2SMS_URL = "https://www.fast2sms.com/dev/whatsapp";

function getConfig() {
  return {
    apiKey: process.env.FAST2SMS_API_KEY || "",
    phoneNumberId: process.env.FAST2SMS_WHATSAPP_PHONE_NUMBER_ID || process.env.FAST2SMS_PHONE_NUMBER_ID || "",
    messageId: process.env.FAST2SMS_MONTHLY_REPORT_MESSAGE_ID || "",
    timeoutMs: Number(process.env.FAST2SMS_TIMEOUT_MS || 30000)
  };
}

function normalizePhone(phone) {
  let value = String(phone || "").trim().replace(/[\s().-]/g, "");
  if (!value) return "";

  // Fast2SMS simple WhatsApp API accepts the destination number as a 10-digit
  // Indian mobile number. Also accept +91 / 91 formats from the UI/database.
  if (value.startsWith("+91")) value = value.slice(3);
  else if (value.startsWith("91") && value.length === 12) value = value.slice(2);

  return value;
}

/**
 * Sends the approved AmbikaShelf monthly_reports WhatsApp template.
 *
 * Template variables from the approved Fast2SMS template:
 *   {{1}} = first name
 *   {{2}} = report month
 *   {{3}} = monthly return percentage
 *
 * The template has a PDF/document header, therefore pdfUrl is required.
 */
async function sendMonthlyReportWhatsApp({
  phone,
  firstName,
  month,
  monthlyReturn,
  pdfUrl,
  documentFilename = "AmbikaShelf_Monthly_Report.pdf"
}) {
  const cfg = getConfig();

  if (!cfg.apiKey) throw new Error("FAST2SMS_API_KEY is not configured");
  if (!cfg.phoneNumberId) throw new Error("FAST2SMS_WHATSAPP_PHONE_NUMBER_ID is not configured");
  if (!cfg.messageId) throw new Error("FAST2SMS_MONTHLY_REPORT_MESSAGE_ID is not configured");

  const number = normalizePhone(phone);
  if (!/^\d{10}$/.test(number)) {
    throw new Error("Invalid WhatsApp number. Use a 10-digit Indian mobile number.");
  }
  if (!pdfUrl) throw new Error("PDF URL is required for the monthly_reports template");

  const pct = monthlyReturn === null || monthlyReturn === undefined || monthlyReturn === ""
    ? "0%"
    : `${Number(monthlyReturn).toFixed(2).replace(/\.00$/, "")}%`;

  const params = new URLSearchParams({
    authorization: cfg.apiKey,
    message_id: String(cfg.messageId),
    phone_number_id: String(cfg.phoneNumberId),
    numbers: number,
    variables_values: [String(firstName || "User"), String(month || ""), pct].join("|"),
    media_url: String(pdfUrl),
    document_filename: String(documentFilename)
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const response = await fetch(`${FAST2SMS_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: cfg.apiKey
      },
      signal: controller.signal
    });

    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch (_) { data = raw; }

    if (!response.ok) {
      const detail = typeof data === "string" ? data : (data.message || data.msg || JSON.stringify(data));
      throw new Error(`Fast2SMS HTTP ${response.status}: ${detail}`);
    }

    // Fast2SMS may return HTTP 200 with an API-level error object.
    if (data && typeof data === "object" && (data.return === false || data.success === false || data.status === false)) {
      throw new Error(data.message || data.msg || JSON.stringify(data));
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  sendMonthlyReportWhatsApp,
  normalizePhone
};
