function num(x) {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Campaign funnel by utm_campaign for leads created in last 90 days.
 * Cohort = leads created in window, EXCLUDING Not Applicable (additional member/director).
 *
 * TLPI definitions (locked v1):
 * - EXCLUDE ENTIRELY: Not Applicable lead stage (1109558437)
 * - Non-MQL = Lead stage "Marketing Prospect" (1134678094)
 * - MQL-Eligible = Leads total - Non-MQL
 * - SQL = Sales Qualified stage (1213103916) PLUS Zoom Booked (qualified-stage-id)
 * - Zoom Booked = lead_stage qualified-stage-id
 * - Disqualified = lead_stage unqualified-stage-id (reported separately)
 * - Deals Won = deal_revenue_rollup_90d by utm_campaign
 */
async function getCampaignFunnel90dByUtmCampaign(pool, opts = {}) {
  const minLeads = opts.minLeads ?? 30;      // used for top/bottom lists (noise control)
  const nTop = opts.nTop ?? 5;
  const nBottom = opts.nBottom ?? 5;

  const STAGE = {
    NON_MQL_MARKETING_PROSPECT: "1134678094",
    NOT_APPLICABLE: "1109558437",
    DISQUALIFIED: "unqualified-stage-id",
    SQL_SALES_QUALIFIED: "1213103916",
    ZOOM_BOOKED: "qualified-stage-id",
  };

  // NOTE: We do NOT filter by minLeads in SQL because we also need an "all campaigns" appendix.
  const { rows } = await pool.query(
    `
    with leads_by_campaign as (
      select
        coalesce(nullif(trim(cec.utm_campaign), ''), 'UNATTRIBUTED') as utm_campaign,
        count(*)::int as leads_total,

        sum(case when l.lead_stage = $1 then 1 else 0 end)::int as non_mql_marketing_prospect,
        sum(case when l.lead_stage = $2 then 1 else 0 end)::int as disqualified,
        sum(case when l.lead_stage = $3 then 1 else 0 end)::int as sql_sales_qualified_stage,
        sum(case when l.lead_stage = $4 then 1 else 0 end)::int as zoom_booked

      from lead_facts_raw l
      join lead_contact_map lcm on lcm.lead_id::text = l.lead_id::text
      left join contact_email_cache cec on cec.contact_id::text = lcm.contact_id::text
      where l.created_at >= (now() - interval '90 days')
        and coalesce(l.lead_stage,'') <> $5   -- EXCLUDE Not Applicable entirely
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
      l.non_mql_marketing_prospect,
      l.disqualified,
      l.sql_sales_qualified_stage,
      l.zoom_booked,
      coalesce(d.deals_won, 0)::int as deals_won
    from leads_by_campaign l
    left join deals_by_campaign d on d.utm_campaign = l.utm_campaign
    `,
    [
      STAGE.NON_MQL_MARKETING_PROSPECT,
      STAGE.DISQUALIFIED,
      STAGE.SQL_SALES_QUALIFIED,
      STAGE.ZOOM_BOOKED,
      STAGE.NOT_APPLICABLE,
    ]
  );

  const shaped = rows.map(r => {
    const leadsTotal = num(r.leads_total);
    const nonMql = num(r.non_mql_marketing_prospect);
    const disq = num(r.disqualified);
    const sqlStage = num(r.sql_sales_qualified_stage);
    const zoom = num(r.zoom_booked);
    const won = num(r.deals_won);

    const mqlEligible = Math.max(0, leadsTotal - nonMql);
    const sqlTotal = sqlStage + zoom; // SQL includes Zoom Booked

    const denom = leadsTotal > 0 ? leadsTotal : 1;

    return {
      utm_campaign: r.utm_campaign,
      leads_total: leadsTotal,
      non_mql_marketing_prospect: nonMql,
      mql_eligible: mqlEligible,
      disqualified: disq,
      sql: sqlTotal,
      zoom_booked: zoom,
      deals_won: won,
      mql_eligible_rate: mqlEligible / denom,
      sql_rate: sqlTotal / denom,
      zoom_rate: zoom / denom,
      disqualified_rate: disq / denom,
      mql_to_sql_rate: mqlEligible > 0 ? (sqlTotal / mqlEligible) : 0,
      sql_to_zoom_rate: sqlTotal > 0 ? (zoom / sqlTotal) : 0,
    };
  });

  const eligible = shaped.filter(x => x.leads_total >= minLeads);

  const top = [...eligible].sort((a, b) => b.zoom_rate - a.zoom_rate).slice(0, nTop);
  const bottom = [...eligible].sort((a, b) => a.zoom_rate - b.zoom_rate).slice(0, nBottom);

  // "all" is intentionally unfiltered; caller/prompt decides presentation.
  return { minLeads, nTop, nBottom, top, bottom, all: shaped };
}

module.exports = { getCampaignFunnel90dByUtmCampaign };
