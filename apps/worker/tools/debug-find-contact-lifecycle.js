require("dotenv/config");
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) { console.error("Missing DATABASE_URL"); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  const { rows } = await pool.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema='public'
      and (
        lower(column_name) like '%lifecyclestage%' or
        lower(column_name) like '%marketingqualifiedlead%' or
        lower(column_name) like '%salesqualifiedlead%' or
        lower(column_name) like '%lifecycle%'
      )
    order by table_name, ordinal_position;
  `);

  console.log("LIFECYCLE_RELATED_COLUMNS", rows);
  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
