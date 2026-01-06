require("dotenv/config");
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) { console.error("Missing DATABASE_URL"); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  const patterns = [
    "contact", "hs_object_id", "vid", "deal", "lead", "association", "campaign", "utm", "gclid", "form"
  ];

  const { rows } = await pool.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema='public'
      and (
        lower(column_name) like '%contact%' or
        lower(column_name) like '%hs_object_id%' or
        lower(column_name) like '%vid%' or
        lower(column_name) like '%deal%' or
        lower(column_name) like '%lead%' or
        lower(column_name) like '%association%' or
        lower(column_name) like '%campaign%' or
        lower(column_name) like '%utm%' or
        lower(column_name) like '%gclid%' or
        lower(column_name) like '%form%'
      )
    order by table_name, ordinal_position;
  `);

  console.log("LINKAGE_COLUMNS_FOUND", rows.length);
  // Print compactly grouped by table
  let current = null;
  for (const r of rows) {
    if (r.table_name !== current) {
      current = r.table_name;
      console.log("\nTABLE", current);
    }
    console.log(` - ${r.column_name} (${r.data_type})`);
  }

  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
