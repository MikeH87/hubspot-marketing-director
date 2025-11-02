const cron = require("node-cron");
const { Pool } = require("pg");
const { sendReportEmail } = require("./lib/mailer");
const { getAllCampaigns, hsGetFromTemplate } = require("../../packages/hubspot/client");

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_snapshots (
      id BIGSERIAL PRIMARY KEY,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      campaign_id TEXT NOT NULL,
      account_id TEXT NULL,
      raw_json JSONB NOT NULL
    );
  `);
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

async function snapshotCampaignAnalytics() {
  const template = process.env.HS_CAMPAIGN_ANALYTICS_PATH_TEMPLATE; // e.g. "/marketing/v3/accounts/{ACCOUNT_ID}/campaigns/{CAMPAIGN_ID}/analytics"
  const accountId = process.env.HS_ACCOUNT_ID || null;
  if (!template) {
    console.log("No HS_CAMPAIGN_ANALYTICS_PATH_TEMPLATE provided — skipping analytics snapshot.");
    return 0;
  }

  // get campaigns from DB (already upserted)
  const { rows } = await pool.query(`SELECT id FROM campaigns ORDER BY id LIMIT 1000;`);
  let saved = 0;
  for (const row of rows) {
    try {
      const data = await hsGetFromTemplate(template, { ACCOUNT_ID: accountId || "", CAMPAIGN_ID: row.id });
      await pool.query(
        `INSERT INTO campaign_snapshots (campaign_id, account_id, raw_json) VALUES ($1, $2, $3);`,
        [row.id, accountId, JSON.stringify(data)]
      );
      saved++;
    } catch (e) {
      console.warn("Snapshot failed for campaign", row.id, "-", e.message);
    }
  }
  return saved;
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
    // 1) Ensure we have current campaigns
    const all = await getAllCampaigns(500);
    await upsertCampaigns(all);
    console.log(`Campaigns upserted (all pages): ${all.length}`);

    // 2) Take analytics snapshots using your template
    const snaps = await snapshotCampaignAnalytics();
    console.log(`Analytics snapshots saved: ${snaps}`);

    // 3) Keep placeholder report for now
    await createPlaceholderReport();

    console.log("RUN_ONCE complete. Idling (no exit).");
  }

  if (!DISABLE_SCHEDULER && !RUN_ONCE) {
    cron.schedule("0 21 * * 0", async () => {
      try {
        console.log("[CRON] Weekly job started…");
        const all = await getAllCampaigns(500);
        await upsertCampaigns(all);
        const snaps = await snapshotCampaignAnalytics();
        console.log(`Analytics snapshots saved: ${snaps}`);
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
