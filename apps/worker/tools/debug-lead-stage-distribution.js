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
    select
      lead_stage,
      count(*)::int as n
    from lead_facts_raw
    where created_at >= (now() - interval '90 days')
    group by lead_stage
    order by n desc, lead_stage asc
    limit 50;
  `);

  console.log("LEAD_STAGE_DISTRIBUTION_TOP50", rows);

  // show a couple of sample rows for any stage that looks like Zoom/Booked/Qualified
  const { rows: samples } = await pool.query(`
    select lead_id, lead_stage, lead_status, created_at
    from lead_facts_raw
    where created_at >= (now() - interval '90 days')
      and (
        lower(coalesce(lead_stage,'')) like '%zoom%' or
        lower(coalesce(lead_stage,'')) like '%book%' or
        lower(coalesce(lead_stage,'')) like '%qual%'
      )
    order by created_at desc
    limit 10;
  `);
  console.log("LEAD_STAGE_SAMPLES_ZOOM_BOOK_QUAL", samples);

  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
