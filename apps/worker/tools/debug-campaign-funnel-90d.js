require("dotenv/config");
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) { console.error("Missing DATABASE_URL"); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
});

// Stage IDs (as per current repo context)
const STAGE = {
  MQL_MARKETING_PROSPECT: "1134678094",
  SQL_SALES_QUALIFIED: "1213103916",
  ZOOM_BOOKED: "qualified-stage-id",
  NOT_APPLICABLE: "1109558437",
};

(async () => {
  const { rows } = await pool.query(`
    with leads_by_campaign as (
      select
        coalesce(nullif(trim(cec.utm_campaign), ''), 'UNATTRIBUTED') as utm_campaign,
        count(*)::int as leads_total,
        sum(case when l.lead_stage = $1 then 1 else 0 end)::int as mql_marketing_prospect,
        sum(case when l.lead_stage = $2 then 1 else 0 end)::int as sql_sales_qualified,
        sum(case when l.lead_stage = $3 then 1 else 0 end)::int as zoom_booked,
        sum(case when l.lead_stage = $4 then 1 else 0 end)::int as not_applicable
      from lead_facts_raw l
      join lead_contact_map lcm on lcm.lead_id::text = l.lead_id::text
      left join contact_email_cache cec on cec.contact_id::text = lcm.contact_id::text
      where l.created_at >= (now() - interval '90 days')
      group by 1
    ),
    deals_by_campaign as (
      select
        coalesce(nullif(trim(utm_campaign), ''), 'UNATTRIBUTED') as utm_campaign,
        sum(coalesce(deals_won,0))::int as deals_won
      from deal_revenue_rollup_90d
      group by 1
    )
    select
      l.utm_campaign,
      l.leads_total,
      l.mql_marketing_prospect,
      l.sql_sales_qualified,
      l.zoom_booked,
      l.not_applicable,
      coalesce(d.deals_won, 0) as deals_won
    from leads_by_campaign l
    left join deals_by_campaign d on d.utm_campaign = l.utm_campaign
    order by l.leads_total desc
    limit 15;
  `, [
    STAGE.MQL_MARKETING_PROSPECT,
    STAGE.SQL_SALES_QUALIFIED,
    STAGE.ZOOM_BOOKED,
    STAGE.NOT_APPLICABLE,
  ]);

  console.log("CAMPAIGN_FUNNEL_90D_TOP15_BY_LEADS", rows);

  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
