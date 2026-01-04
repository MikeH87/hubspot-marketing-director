require("dotenv").config({ path: __dirname + "/../.env" });

const { Pool } = require("pg");
const { sendReportEmail } = require("../lib/mailer");
const { generateGptReport } = require("../lib/gptReport");

function getMostRecentMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().split("T")[0];
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing (apps/worker/.env)");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
  });

  // Ensure reports table exists (same as worker)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      week_start DATE PRIMARY KEY,
      summary TEXT
    );
  `);

  const weekStart = getMostRecentMonday(new Date());

  let summary = `Placeholder report for week starting ${weekStart}`;
  const gpt = await generateGptReport({ pool });
  if (gpt) summary = gpt;

  await pool.query(
    "INSERT INTO reports (week_start, summary) VALUES ($1, $2) ON CONFLICT (week_start) DO UPDATE SET summary = EXCLUDED.summary;",
    [weekStart, summary]
  );

  console.log("Inserted weekly report for", weekStart);

  const to = process.env.EMAIL_TO || process.env.SMTP_USER;
  if (!to) throw new Error("No EMAIL_TO (or SMTP_USER fallback) configured.");

  await sendReportEmail({
    to,
    subject: `Weekly marketing report (${weekStart})`,
    text: summary
  });

  await pool.end();
  console.log("DONE (report generated + emailed).");
  process.exit(0);
})().catch(e => {
  console.error("FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
});
