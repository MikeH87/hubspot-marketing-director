/**
 * lib/gptReport.js (CommonJS)
 * Builds the weekly boardroom report using:
 *  - Sales truth totals (close date window) incl. revenue, deals, units sold
 *  - Campaign-attributed rollups from campaign_context_snapshot_90d.lifecycle_counts
 *  - Consultant-only lead funnel based on LEAD hs_pipeline_stage (lead_facts_raw.lead_stage)
 */

const dotenv = require("dotenv");
dotenv.config();

const pg = require("pg");
const { Pool } = pg;

// OpenAI client (CommonJS-safe)
const OpenAIImport = require("openai");
const OpenAI = OpenAIImport?.default || OpenAIImport;
const { getCampaignFunnel90dByUtmCampaign } = require("./campaignFunnel");
function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const CONSULTANT_NAMES = new Set([
  "Jordan Sharpe",
  "Laura McCarthy",
  "Akash Bajaj",
  "Gareth Robertson",
  "David Gittings",
  "Spencer Dunn",
]);

// Lead pipeline stage IDs (from STEP16A)
const LEAD_STAGE = {
  NEW: "new-stage-id",
  ATTEMPTING: "attempting-stage-id",
  CONNECTED: "connected-stage-id",
  SALES_QUALIFIED: "1213103916",
  ZOOM_BOOKED: "qualified-stage-id",
  DISQUALIFIED: "unqualified-stage-id",
  NOT_APPLICABLE: "1109558437",
  MARKETING_PROSPECT: "1134678094",
};

function num(x) {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function tableColumns(pool, tableName) {
  const { rows } = await pool.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
    [tableName]
  );
  return new Set(rows.map(r => r.column_name));
}

async function getLatestSalesTruth(pool) {
  // We try a few shapes since we’ve iterated during the build.
  const candidates = [
    { table: "sales_truth_totals_90d", cols: ["window_start_date", "window_end_date", "deals_won_count", "revenue_won", "units_sold", "revenue_new_prospect", "revenue_old_prospect"] },
{ table: "sales_truth_totals_90d", cols: ["window_start", "window_end", "deals_won", "revenue_won_amount", "units_sold"] },
    { table: "sales_truth_totals_90d", cols: ["window_start", "window_end", "deals_won", "revenue_won", "units_sold"] },
    { table: "sales_truth_totals_90d", cols: ["window_start_date", "window_end_date", "deals_won", "revenue_won_amount", "units_sold"] },
  ];

  for (const c of candidates) {
    const cols = await tableColumns(pool, c.table).catch(() => null);
    if (!cols) continue;
    if (!c.cols.every(k => cols.has(k))) continue;

    const sql = `
      select *
      from ${c.table}
      order by updated_at desc
      limit 1
    `;
    const { rows } = await pool.query(sql);
    if (!rows?.length) continue;

    const r = rows[0];
    const windowStart = r.window_start ?? r.window_start_date;
    const windowEnd = r.window_end ?? r.window_end_date;

    const revenueWon = r.revenue_won_amount ?? r.revenue_won ?? 0;
    const dealsWon = r.deals_won ?? r.deals_won_count ?? 0;
    const unitsSold = r.units_sold ?? r.units_won ?? 0;

    const revenueNew = r.revenue_new_prospects ?? r.revenue_new_prospect ?? r.revenue_from_new_prospects ?? r.revenue_new ?? 0;
    const revenueOld = r.revenue_old_prospects ?? r.revenue_old_prospect ?? r.revenue_from_older_prospects ?? r.revenue_old ?? 0;

    return {
      windowStart,
      windowEnd,
      revenueWon,
      dealsWon,
      unitsSold,
      revenueNew,
      revenueOld,
    };
  }

  return null;
}

function lcNum(lc, key) {
  return num(lc?.[key]);
}

async function getCampaignSnapshot(pool) {
  const { rows } = await pool.query(`
    select
      id,
      campaign_id,
      campaign_name,
      lifecycle_counts,
      asset_counts,
      sessions_90d,
      new_contacts_90d
    from campaign_context_snapshot_90d
    order by id::int asc
  `);

  let attributedRevenue = 0;
  let attributedDealsWon = 0;
  let attributedPipeline = 0;

  const normalised = rows.map(r => {
    const lc = r.lifecycle_counts || {};
    const revenue = lcNum(lc, "revenue_won_90d_sales");
    const dealsWon = lcNum(lc, "deals_won_90d_sales");
    const pipeline = lcNum(lc, "pipeline_created_90d_sales");

    attributedRevenue += revenue;
    attributedDealsWon += dealsWon;
    attributedPipeline += pipeline;

    return {
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      lifecycle_counts: lc,
      asset_counts: r.asset_counts || {},
      sessions_90d: r.sessions_90d,
      new_contacts_90d: r.new_contacts_90d,
    };
  });

  const topByRevenue = [...normalised].sort((a, b) =>
    lcNum(b.lifecycle_counts, "revenue_won_90d_sales") - lcNum(a.lifecycle_counts, "revenue_won_90d_sales")
  );

  const topByPipeline = [...normalised].sort((a, b) =>
    lcNum(b.lifecycle_counts, "pipeline_created_90d_sales") - lcNum(a.lifecycle_counts, "pipeline_created_90d_sales")
  );

  return { rows: normalised, attributedRevenue, attributedDealsWon, attributedPipeline, topByRevenue, topByPipeline };
}

async function getConsultantLeadFunnel(pool) {
  // Determine which owner name column exists in owner_cache
  const cols = await tableColumns(pool, "owner_cache");
  const nameCol =
    cols.has("owner_name") ? "owner_name" :
    cols.has("full_name") ? "full_name" :
    cols.has("name") ? "name" :
    cols.has("owner_full_name") ? "owner_full_name" :
    null;

  // If we can't find a good name column, fall back to UNASSIGNED (still runs)
  const ownerNameExpr = nameCol ? `oc.${nameCol}` : "null";

  const { rows } = await pool.query(`
    select
      coalesce(${ownerNameExpr}, 'UNASSIGNED') as owner_name,
      l.lead_stage as lead_stage,
      l.disqualification_reason as disq_reason,
      count(*)::int as n
    from lead_facts_raw l
    left join owner_cache oc on oc.owner_id::text = l.owner_id::text
    where l.created_at >= (now() - interval '90 days')
      and l.lead_stage is not null
    group by 1,2,3
  `);

  const byOwner = new Map();

  function ensure(owner) {
    if (!byOwner.has(owner)) {
      byOwner.set(owner, {
        total: 0,
        zoom_booked: 0,
        sales_qualified: 0,
        disqualified: 0,
        marketing_prospect: 0,
        connected: 0,
        attempting: 0,
        new: 0,
        not_applicable: 0,
        disqReasons: new Map(),
      });
    }
    return byOwner.get(owner);
  }

  for (const r of rows) {
    const owner = r.owner_name || "UNASSIGNED";
    if (!CONSULTANT_NAMES.has(owner)) continue;

    const b = ensure(owner);
    const stage = r.lead_stage;
    const n = num(r.n);

    b.total += n;

    if (stage === LEAD_STAGE.ZOOM_BOOKED) b.zoom_booked += n;
    else if (stage === LEAD_STAGE.SALES_QUALIFIED) b.sales_qualified += n;
    else if (stage === LEAD_STAGE.DISQUALIFIED) b.disqualified += n;
    else if (stage === LEAD_STAGE.MARKETING_PROSPECT) b.marketing_prospect += n;
    else if (stage === LEAD_STAGE.CONNECTED) b.connected += n;
    else if (stage === LEAD_STAGE.ATTEMPTING) b.attempting += n;
    else if (stage === LEAD_STAGE.NEW) b.new += n;
    else if (stage === LEAD_STAGE.NOT_APPLICABLE) b.not_applicable += n;

    if (stage === LEAD_STAGE.DISQUALIFIED) {
      const reason = String(r.disq_reason || "NO_REASON");
      b.disqReasons.set(reason, (b.disqReasons.get(reason) || 0) + n);
    }
  }

  const out = [];
  for (const [owner, b] of byOwner.entries()) {
    // callable = excluding Marketing Prospect + Not Applicable
    const callable = Math.max(0, b.total - b.marketing_prospect - b.not_applicable);
    const disqRate = callable > 0 ? b.disqualified / callable : 0;
    const zoomRate = callable > 0 ? b.zoom_booked / callable : 0;

    const topReasons = [...b.disqReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}:${v}`);

    out.push({ owner, ...b, callable, disqRate, zoomRate, topReasons });
  }

  out.sort((a, b) => b.callable - a.callable);
  return out;
}

function buildPayload({ truth, campaign, consultants }) {
  const truthRevenue = truth ? num(truth.revenueWon) : null;
  const truthDeals = truth ? num(truth.dealsWon) : null;
  const truthUnits = truth ? num(truth.unitsSold) : null;

  const attributedRevenue = num(campaign.attributedRevenue);
  const attributedDealsWon = num(campaign.attributedDealsWon);

  const unattributedRevenue = truthRevenue === null ? null : Math.max(0, truthRevenue - attributedRevenue);
  const unattributedDeals = truthDeals === null ? null : Math.max(0, truthDeals - attributedDealsWon);

  const topRevenue = campaign.topByRevenue.slice(0, 8).map(r => ({
    name: r.campaign_name || r.campaign_id,
    revenue_won: lcNum(r.lifecycle_counts, "revenue_won_90d_sales"),
    deals_won: lcNum(r.lifecycle_counts, "deals_won_90d_sales"),
    pipeline_created: lcNum(r.lifecycle_counts, "pipeline_created_90d_sales"),
    new_contacts: num(r.new_contacts_90d),
  }));

  const topPipeline = campaign.topByPipeline.slice(0, 8).map(r => ({
    name: r.campaign_name || r.campaign_id,
    pipeline_created: lcNum(r.lifecycle_counts, "pipeline_created_90d_sales"),
    revenue_won: lcNum(r.lifecycle_counts, "revenue_won_90d_sales"),
    deals_created: lcNum(r.lifecycle_counts, "deals_created_90d_sales"),
    new_contacts: num(r.new_contacts_90d),
  }));

  // Campaign pipeline performance (data-driven). We use pipeline_created vs contacts created as an "early" signal.
  // Note: lead_facts_raw currently lacks campaign_id linkage, so stage-level funnel by campaign is not available yet.
  const pipelinePerfAll = (campaign.rows || []).map(r => {
    const newContacts = num(r.new_contacts_90d);
    const pipelineCreated = lcNum(r.lifecycle_counts, "pipeline_created_90d_sales");
    const dealsCreated = lcNum(r.lifecycle_counts, "deals_created_90d_sales");
    const dealsWon = lcNum(r.lifecycle_counts, "deals_won_90d_sales");
    const revenueWon = lcNum(r.lifecycle_counts, "revenue_won_90d_sales");

    const pipelinePerContact = newContacts > 0 ? (pipelineCreated / newContacts) : 0;
    const dealsWonPerContact = newContacts > 0 ? (dealsWon / newContacts) : 0;

    return {
      name: r.campaign_name || r.campaign_id,
      new_contacts: newContacts,
      pipeline_created: pipelineCreated,
      deals_created: dealsCreated,
      deals_won: dealsWon,
      revenue_won: revenueWon,
      pipeline_per_contact: pipelinePerContact,
      deals_won_per_contact: dealsWonPerContact,
    };
  });

  // Avoid tiny-sample noise: require at least 20 new contacts in the 90d window
  const pipelinePerfEligible = pipelinePerfAll.filter(x => x.new_contacts >= 20);

  const topPipelineEfficiency = [...pipelinePerfEligible]
    .sort((a, b) => b.pipeline_per_contact - a.pipeline_per_contact)
    .slice(0, 3);

  const bottomPipelineEfficiency = [...pipelinePerfEligible]
    .sort((a, b) => a.pipeline_per_contact - b.pipeline_per_contact)
    .slice(0, 3);


  return {
    truth,
    totals: {
      truthRevenue,
      truthDeals,
      truthUnits,
      revenueNew: truth ? num(truth.revenueNew) : null,
      revenueOld: truth ? num(truth.revenueOld) : null,
      attributedRevenue,
      attributedDealsWon,
      unattributedRevenue,
      unattributedDeals,
      attributedPipeline: num(campaign.attributedPipeline),
    },
    topRevenue,
    topPipeline,
    topPipelineEfficiency,
    bottomPipelineEfficiency,
    consultants,
  };
}

async function generateGptReport() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });

  const openai = new OpenAI({ apiKey: need("OPENAI_API_KEY") });

  const [truth, campaign, consultants, campaignFunnel] = await Promise.all([ getLatestSalesTruth(pool), getCampaignSnapshot(pool), getConsultantLeadFunnel(pool), getCampaignFunnel90dByUtmCampaign(pool, { minLeads: 30 }) ]);

  const payload = buildPayload({ truth, campaign, consultants }); payload.campaignFunnel = campaignFunnel;

  const system = `
You write a boardroom-ready weekly report for a UK marketing director.
Be specific, numerical, and action-oriented.
Use GBP (£) formatting, bullet points, and short headings.

For lead qualification, treat "Zoom Booked" as the qualified milestone.

Consultants section must ONLY include:
Jordan Sharpe, Laura McCarthy, Akash Bajaj, Gareth Robertson, David Gittings, Spencer Dunn.

Explain attribution coverage clearly:
- Truth totals = ALL Sales Pipeline closed-won deals in window (close date)
- Attributed totals = deals/revenue linked to campaigns via our attribution rules
- Unattributed = truth minus attributed

If truth totals are missing, say so explicitly and do not invent them.
`.trim();

      const user = `
Generate the report in TWO main sections plus executive summary.

CRITICAL ACCURACY RULES:
- Treat "UNATTRIBUTED" as a tracking bucket (not a campaign). Recommend attribution fixes, not campaign optimisation.
- For any disqualification reasons list, ALWAYS include counts (e.g., "Not Contactable: 100"), never names-only.
- Use ONLY numbers present in the Data JSON. Do NOT create, estimate, infer, or “fill in” missing figures.
- If a number is not present, write "N/A".
- Keep table values strictly aligned to the Data JSON fields. ALL rates must be shown as percentages (rate * 100, rounded to 2dp, with % sign).
- Do not invent campaign names; use the names/keys provided.

1) Executive Summary (truth totals + attribution coverage + actions)
Must include:
- Total Revenue Won (Truth)
- Total Deals Won (Truth)
- Total Units Sold (Truth)
- New Prospect Revenue (<=30d) vs Older/Unknown Revenue
- Attributed vs Unattributed revenue and deals (Unattributed = Truth minus Attributed)
- Attributed Pipeline Created (campaign-only)

Then add: Top 3 Actions (next 7 days)
- EXACTLY 3 actions.
- Each action must cite the specific signal from the Data JSON (e.g., unattributed gap £X, top/bottom campaign funnel outliers, consultant outlier rates, top disqualification reasons) and a concrete next step.
- Do not reference any data not in the Data JSON.

2) A) Marketing Performance
Include:
- Top campaigns by attributed revenue (table)
- Top campaigns by attributed pipeline (table)

Add: Campaign Funnel Performance (90d, by utm_campaign via contact linkage)
Explain briefly: this is an earlier-stage view than revenue, suitable for long sales cycles.
Show TWO tables (each exactly 5 rows), using ONLY: payload.campaignFunnel.top and payload.campaignFunnel.bottom
payload.campaignFunnel.top and payload.campaignFunnel.bottom

Tables:
A) Top 5 campaigns by Zoom Booked rate (earliest strong sales-signal)
B) Bottom 5 campaigns by Zoom Booked rate

Appendix: All Campaigns (90d) sorted by Zoom Booked %
- Include EVERY row from payload.campaignFunnel.all (including UNATTRIBUTED).
- Sort descending by Zoom Booked rate.
- Use the SAME columns as the funnel tables, including MQL→SQL % and SQL→Zoom %.
- Show percentages (e.g., 12.3%), never decimals.


Each row must include these COUNT columns (no percentages required):
Campaign (utm_campaign) | Leads Total | Non-MQL (Marketing Prospect) | MQL-Eligible | Disqualified | SQL | Zoom Booked | Deals Won | MQL→SQL % | SQL→Zoom %
For each campaign row, populate MQL→SQL % from mql_to_sql_rate and SQL→Zoom % from sql_to_zoom_rate, formatted as percentages (e.g., 12.3%).

- Lead quality: top disqualification reasons overall (aggregate from consultant disq reasons)
- Concrete Actions: 3–5 actions, grounded ONLY in the Data JSON (no guessing)

3) B) Sales Performance (Consultants Only)
For each consultant show:
- Callable leads (exclude Marketing Prospect + Not Applicable)
- Zoom Booked count + rate (format rate as a percentage, e.g. 8.47%)
- Sales Qualified count
- Disqualified count + rate
- Top 3 disqualification reasons
Then call out:
- Best/worst outliers on Zoom Booked rate and Disqualification rate (ALWAYS show percentages, never decimals)
- Coaching priorities tied to reasons

Data JSON:
${JSON.stringify(payload, null, 2)}
  `.trim();

  const resp = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  await pool.end();

  return (resp.choices?.[0]?.message?.content || "").trim();
}

module.exports = { generateGptReport };

















