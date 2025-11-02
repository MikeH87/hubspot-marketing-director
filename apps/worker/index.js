const cron = require("node-cron");
const { Pool } = require("pg");
const { sendReportEmail } = require("./lib/mailer");
const { getAllCampaigns } = require("../../packages/hubspot/client");

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      week_start DATE PRIMARY KEY,
      summary TEXT
    );
  `);
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

function maybeFilterTests(arr) {
  const flag = (process.env.EXCLUDE_TEST_CAMPAIGNS || "").toLowerCase() === "true";
  if (!flag) return arr;
  const re = /(test|sandbox|dummy)/i;
  return arr.filter(c => !re.test(String(c.name || "")));
}

async function upsertCampaigns(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const sql = `
    INSERT INTO campaigns (id, name, type, app_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        type = EXCLUDED.type,
        app_id = EXCLUDED.app_id,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
  `;
  let n = 0;
  for (const c of rows) {
    const params = [
      String(c.id || ""),
      c.name || null,
      c.type || null,
      Number.isFinite(c.appId) ? c.appId : null,
      c.createdAt ? new Date(c.createdAt) : null,
      c.updatedAt ? new Date(c.updatedAt) : null
    ];
    await pool.query(sql, params);
    n++;
  }
  return n;
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
  if (to) await sendReportEmail({ to, subject: `Weekly marketing report (${weekStart})`, text: summary });
}

async function main() {
  console.log("Worker booted. Scheduler initialising…");
  const RUN_ONCE = (process.env.RUN_ONCE || "").toLowerCase() === "true";
  const DISABLE_SCHEDULER = (process.env.DISABLE_SCHEDULER || "").toLowerCase() === "true";

  await ensureCoreTables();

  if (RUN_ONCE) {
    await createPlaceholderReport();

    try {
      let campaigns = await getAllCampaigns(500);
      campaigns = maybeFilterTests(campaigns);
      const saved = await upsertCampaigns(campaigns);
      console.log(`Campaigns upserted (all pages): ${saved}`);
      if (campaigns.length) {
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
