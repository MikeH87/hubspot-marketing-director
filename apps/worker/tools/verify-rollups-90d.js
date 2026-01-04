require("dotenv").config({ path: __dirname + "/../.env" }); // always use apps/worker/.env
const { Pool } = require("pg");

(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check apps/worker/.env");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const r = await pool.query(`
    select
      count(*)::int as rows_total,
      count(deal_ids_90d)::int as rows_with_deals,
      count(revenue_by_dealtype_90d)::int as rows_with_revenue_rollup,
      count(deals_won_by_dealtype_90d)::int as rows_with_won_rollup
    from campaign_context_snapshot_90d
  `);

  console.log(r.rows[0]);
  await pool.end();
})().catch(e => {
  console.error("FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
});
