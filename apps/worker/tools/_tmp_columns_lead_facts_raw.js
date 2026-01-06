require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) throw new Error("Missing DATABASE_URL (or RENDER_DATABASE_URL).");

(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const r = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='lead_facts_raw'
    ORDER BY ordinal_position;
  `);
  console.log("=== lead_facts_raw columns ===");
  for (const row of r.rows) console.log("- " + row.column_name);
  console.log("STEP16B0_OK");
  await pool.end();
})().catch(e => { console.error(e); console.log("STEP16B0_FAILED"); process.exit(1); });
