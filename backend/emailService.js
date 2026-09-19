const { Resend } = require("resend");

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

module.exports = { sendEmail };
