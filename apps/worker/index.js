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

async function ensureCoreTables() {
  // reports
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      week_start DATE PRIMARY KEY,
      summary TEXT
    );
  `);

  // campaigns
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      app_id INTEGER,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );
  `);
}

async function upsertCampaigns(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const text = `
    INSERT INTO campaigns (id, name, type, app_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        type = EXCLUDED.type,
        app_id = EXCLUDED.app_id,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
  `;
  let count = 0;
  for (const c of rows) {
    const params = [
      String(c.id || ""),
      c.name || null,
      c.type || null,
      Number.isFinite(c.appId) ? c.appId : null,
      c.createdAt ? new Date(c.createdAt) : null,
      c.updatedAt ? new Date(c.updatedAt) : null
    ];
    await pool.query(text, params);
    count++;
  }
  return count;
}

async function createPlaceholderReport() {
  const weekStart = getMostRecentMonday(new Date());
  const summary = `Placeholder report for week starting ${weekStart}`;
  await pool.query(
    "INSERT INTO reports (week_start, summary) VALUES ($1, $2) ON CONFLICT (week_start) DO UPDATE SET summary = EXCLUDED.summary;",
    [weekStart, summary]
  );
  console.log("Inserted placeholder weekly report for", weekStart);

  const to = process.env.EMAIL_TO || process.env.SMTP_USER;
  if (to) {
    await sendReportEmail({ to, subject: `Weekly marketing report (${weekStart})`, text: summary });
  }
}

async function main() {
  console.log("Worker booted. Scheduler initialising…");

  const RUN_ONCE = (process.env.RUN_ONCE || "").toLowerCase() === "true";
  const DISABLE_SCHEDULER = (process.env.DISABLE_SCHEDULER || "").toLowerCase() === "true";

  // Ensure tables exist
  await ensureCoreTables();

  if (RUN_ONCE) {
    // 1) Save the placeholder report like before
    await createPlaceholderReport();

    // 2) Fetch campaigns from HubSpot and upsert into DB
    try {
      const campaigns = await getCampaigns(50);
      const saved = await upsertCampaigns(campaigns);
      console.log(`Campaigns upserted: ${saved}`);
      if (saved) {
        const sample = campaigns.slice(0, 3).map(c => c.name || c.id);
        console.log("Sample campaigns:", sample.join(" | "));
      }
    } catch (e) {
      console.error("Campaign fetch/upsert failed:", e.message);
    }

    console.log("RUN_ONCE complete. Idling (no exit).");
  }

  if (!DISABLE_SCHEDULER && !RUN_ONCE) {
    cron.schedule("0 21 * * 0", async () => {
      try {
        console.log("[CRON] Weekly job started…");
        await createPlaceholderReport();
        // (Next steps: pull metrics & store snapshots here)
        console.log("[CRON] Weekly job finished.");
      } catch (err) {
        console.error("[CRON] Error:", err);
      }
    });
    console.log("Scheduler running. Waiting for next trigger…");
  } else {
    console.log("Scheduler disabled (DISABLE_SCHEDULER=true or RUN_ONCE=true). Idling.");
  }

  // Keep process alive
  setInterval(() => {}, 1e9);
}

main().catch(err => console.error("Worker fatal error:", err));
