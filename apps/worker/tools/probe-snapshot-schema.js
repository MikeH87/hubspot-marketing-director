require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) { console.log("Missing DATABASE_URL (or RENDER_DATABASE_URL)."); console.log("STEP15C1_FAILED"); process.exit(1); }

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1
  });

  const cols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='campaign_context_snapshot_90d'
    ORDER BY ordinal_position
  `);

  console.log("=== campaign_context_snapshot_90d columns ===");
  console.log(cols.rows.map(r => r.column_name).join(", "));

  const sample = await pool.query(`SELECT * FROM campaign_context_snapshot_90d LIMIT 1`);
  console.log("=== sample row keys ===");
  if (sample.rows[0]) console.log(Object.keys(sample.rows[0]).join(", "));
  else console.log("(no rows)");

  console.log("=== sample row (trimmed) ===");
  if (sample.rows[0]) console.log(JSON.stringify(sample.rows[0], null, 2).slice(0, 1500));
  else console.log("(no rows)");

  await pool.end();
  console.log("STEP15C1_OK");
}

main().catch(e => { console.error(e); console.log("STEP15C1_FAILED"); process.exit(1); });
