const nodemailer = require("nodemailer");

function getTransport() {
  if ((process.env.EMAIL_PROVIDER || "").toLowerCase() !== "smtp") {
    return null;
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("Email disabled: SMTP env vars missing.");
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendReportEmail({ to, subject, text }) {
  const transport = getTransport();
  if (!transport) {
    console.warn("Email transport not configured; skipping send.");
    return;
  }
  const from = process.env.SMTP_USER;
  await transport.sendMail({ from, to, subject, text });
  console.log("Email sent to", to);
}

module.exports = { sendReportEmail };
