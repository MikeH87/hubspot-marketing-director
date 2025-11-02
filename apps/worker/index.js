const cron = require("node-cron");
const { Pool } = require("pg");
const { sendReportEmail } = require("../../packages/email/mailer");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
});

function getMostRecentMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().split("T")[0];
}

async function ensureReportsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      week_start DATE PRIMARY KEY,
      summary TEXT
    );
  `);
}

async function createPlaceholderReport() {
  const weekStart = getMostRecentMonday(new Date());
  const summary = `Placeholder report for week starting ${weekStart}`;

  await ensureReportsTable();
  await pool.query(
    "INSERT INTO reports (week_start, summary) VALUES ($1, $2) ON CONFLICT (week_start) DO UPDATE SET summary = EXCLUDED.summary;",
    [weekStart, summary]
  );

  console.log("Inserted placeholder weekly report for", weekStart);

  // Send email if SMTP is configured
  const to = process.env.EMAIL_TO || process.env.SMTP_USER;
  if (to) {
    await sendReportEmail({
      to,
      subject: `Weekly marketing report (${weekStart})`,
      text: summary
    });
  }
}

async function main() {
  console.log("Worker booted. Scheduler initialising…");

  // Run immediately if RUN_ONCE=true (manual test)
  if ((process.env.RUN_ONCE || "").toLowerCase() === "true") {
    await createPlaceholderReport();
    console.log("RUN_ONCE complete. Exiting.");
    process.exit(0);
  }

  // Weekly schedule: Sundays 21:00 UK (cron uses server/UTC time)
  cron.schedule("0 21 * * 0", async () => {
    try {
      console.log("[CRON] Weekly job started…");
      await createPlaceholderReport();
      console.log("[CRON] Weekly job finished.");
    } catch (err) {
      console.error("[CRON] Error:", err);
    }
  });

  console.log("Scheduler running. Waiting for next trigger…");
}

main().catch(err => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
