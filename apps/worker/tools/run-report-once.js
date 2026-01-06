require("dotenv/config");
const { Pool } = require("pg");
const { sendReportEmail } = require("../lib/mailer");
const { generateGptReport } = require("../lib/gptReport");
const { marked } = require("marked");

function mdToEmailHtml(md) {
  let html = marked.parse(md);

  // Inline styles for email-client compatibility
  html = html
    .replace(/<table>/g, '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:13px;">')
    .replace(/<th>/g, '<th style="background:#f3f3f3;text-align:left;border:1px solid #ddd;padding:6px;">')
    .replace(/<td>/g, '<td style="border:1px solid #ddd;padding:6px;vertical-align:top;">');

  return '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45">' + html + "</div>";
}

(async () => {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!DATABASE_URL) throw new Error("Missing DATABASE_URL (or RENDER_DATABASE_URL).");

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });

  const weekStart =
    process.env.WEEK_START ||
    new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  let summary = `# Weekly Marketing and Sales Report\n\n(Report generation placeholder)\n`;
  const gpt = await generateGptReport({ pool });
  if (gpt) summary = gpt;

  await pool.query(
    "INSERT INTO reports (week_start, summary) VALUES ($1, $2) ON CONFLICT (week_start) DO UPDATE SET summary = EXCLUDED.summary;",
    [weekStart, summary]
  );

  console.log("Inserted weekly report for", weekStart);

  const to = process.env.EMAIL_TO || process.env.SMTP_USER;
  if (!to) throw new Error("No EMAIL_TO (or SMTP_USER fallback) configured.");

  const html = mdToEmailHtml(summary);

  await sendReportEmail({
    to,
    subject: `Weekly marketing report (${weekStart})`,
    text: summary,
    html,
  });

  await pool.end();
  console.log("DONE (report generated + emailed).");
  process.exit(0);
})().catch(e => {
  console.error("FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
});
