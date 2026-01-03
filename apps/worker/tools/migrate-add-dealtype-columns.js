require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
});

(async () => {
  await pool.query(`
    ALTER TABLE campaign_context_snapshot_90d
      ADD COLUMN IF NOT EXISTS deal_ids_90d JSONB,
      ADD COLUMN IF NOT EXISTS revenue_by_dealtype_90d JSONB,
      ADD COLUMN IF NOT EXISTS deals_won_by_dealtype_90d JSONB;
  `);

  console.log("Schema updated (dealtype columns).");
  await pool.end();
})().catch(e => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
