const cron = require("node-cron");
const { Pool } = require("pg");
const { sendReportEmail } = require("./lib/mailer");
const { getCampaigns } = require("../../packages/hubspot/client");

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

  const to = process.env.EMAIL_TO || process.env.SMTP_USER;
  if (to) await sendReportEmail({ to, subject: `Weekly marketing report (${weekStart})`, text: summary });
}

async function main() {
  console.log("Worker booted. Scheduler initialising…");
  const RUN_ONCE = (process.env.RUN_ONCE || "").toLowerCase() === "true";
  const DISABLE_SCHEDULER = (process.env.DISABLE_SCHEDULER || "").toLowerCase() === "true";

  if (RUN_ONCE) {
    await createPlaceholderReport();

    try {
      const campaigns = await getCampaigns(10);
      console.log(`HubSpot campaigns fetched: ${campaigns.length}`);
      if (campaigns.length) {
        console.log("Sample campaign names:");
        campaigns.slice(0, 3).forEach((c, i) => console.log(`${i + 1}. ${c.name || c.id}`));
      }
    } catch (e) {
      console.error("Campaign fetch failed:", e.message);
    }

    console.log("RUN_ONCE complete. Idling (no exit).");
  }

  if (!DISABLE_SCHEDULER && !RUN_ONCE) {
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
  } else {
    console.log("Scheduler disabled (DISABLE_SCHEDULER=true or RUN_ONCE=true). Idling.");
  }

  setInterval(() => {}, 1e9);
}

main().catch(err => console.error("Worker fatal error:", err));
