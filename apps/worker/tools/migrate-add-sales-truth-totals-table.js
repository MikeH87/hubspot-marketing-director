import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)."); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_truth_totals_90d (
      window_start DATE NOT NULL,
      window_end   DATE NOT NULL,
      deals_won    INT  NOT NULL,
      revenue_won_amount NUMERIC NOT NULL,
      units_sold   INT  NOT NULL,
      revenue_new_prospects NUMERIC NOT NULL,
      revenue_old_or_unknown NUMERIC NOT NULL,
      deals_missing_contact_createdate INT NOT NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (window_start, window_end)
    );
  `);

  console.log("SALES_TRUTH_TABLE_OK");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await pool.end(); });
