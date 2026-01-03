require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const candidates = ["campaign_context_snapshot_90d_filtered", "campaign_context_snapshot_90d"];

  for (const t of candidates) {
    const exists = await pool.query(
      `select 1 from information_schema.tables where table_schema='public' and table_name=$1`,
      [t]
    );
    if (!exists.rowCount) {
      console.log(`${t}: (missing)`);
      continue;
    }

    const counts = await pool.query(`
      select
        count(*) as rows,
        count(*) filter (where deal_ids_90d is not null) as with_deal_ids,
        count(*) filter (where deal_ids_90d is not null and deal_ids_90d::text <> 'null') as with_nonnull_json
      from ${t};
    `);

    console.log(`${t}: rows=${counts.rows[0].rows}, deal_ids_90d(not null)=${counts.rows[0].with_deal_ids}, deal_ids_90d(non-null json)=${counts.rows[0].with_nonnull_json}`);
  }

  await pool.end();
})().catch(e => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
