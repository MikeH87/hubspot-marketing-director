require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const tables = await pool.query(`
    select table_name
    from information_schema.tables
    where table_schema='public'
      and table_name ilike '%campaign%context%snapshot%'
    order by table_name;
  `);

  console.log("Campaign snapshot tables:");
  for (const r of tables.rows) {
    const cols = await pool.query(
      `select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,
      [r.table_name]
    );
    console.log("\n- " + r.table_name);
    console.log("  " + cols.rows.map(c => c.column_name).join(", "));
  }

  await pool.end();
})().catch(e => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
