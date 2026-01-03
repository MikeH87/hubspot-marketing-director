require("dotenv").config();
const { Pool } = require("pg");

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN in apps/worker/.env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function hsFetch(path, opts = {}) {
  const url = `https://api.hubapi.com${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }

  if (!res.ok) {
    throw new Error(`HubSpot ${opts.method || "GET"} ${path} failed: ${res.status} ${text}`);
  }
  return json;
}

function toHsMs(isoOrDate) {
  const d = (isoOrDate instanceof Date) ? isoOrDate : new Date(isoOrDate);
  return d.getTime();
}

(async () => {
  // 1) Get the rolling window from the snapshot table
  const w = await pool.query(`
    select min(window_start) as window_start, max(window_end) as window_end
    from campaign_context_snapshot_90d
  `);

  const windowStart = w.rows[0].window_start;
  const windowEnd = w.rows[0].window_end;

  if (!windowStart || !windowEnd) {
    throw new Error("Could not read window_start/window_end from campaign_context_snapshot_90d");
  }

  console.log(`Rolling window: ${new Date(windowStart).toISOString().slice(0,10)} to ${new Date(windowEnd).toISOString().slice(0,10)}`);

  // 2) Pull ALL deals created in the window (paged)
  const dealProps = [
    "dealname",
    "dealtype",
    "amount",
    "pipeline",
    "dealstage",
    "closedate",
    "hs_is_closed_won"
  ];

  let after = 0;
  const deals = [];
  while (true) {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: "createdate", operator: "GTE", value: String(toHsMs(windowStart)) },
          { propertyName: "createdate", operator: "LTE", value: String(toHsMs(windowEnd)) },
        ],
      }],
      properties: dealProps,
      limit: 100,
      after: after || 0,
    };

    const resp = await hsFetch(`/crm/v3/objects/deals/search`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (resp && resp.results) deals.push(...resp.results);
    if (!resp.paging || !resp.paging.next || !resp.paging.next.after) break;
    after = resp.paging.next.after;
  }

  console.log(`Deals pulled (created in window): ${deals.length}`);

  if (deals.length === 0) {
    console.log("No deals in window. Nothing to backfill.");
    await pool.end();
    return;
  }

  // 3) For each deal, fetch associated contacts, pick the first as “primary”
  //    Then batch-read those contacts to get converting campaign fields.
  const dealToPrimaryContact = new Map();
  const contactIds = new Set();

  for (const d of deals) {
    const assoc = await hsFetch(`/crm/v3/objects/deals/${d.id}/associations/contacts?limit=100`);
    const ids = (assoc.results || []).map(x => x.id).filter(Boolean);
    const primary = ids[0] || null;
    if (primary) {
      dealToPrimaryContact.set(d.id, primary);
      contactIds.add(primary);
    }
  }

  console.log(`Primary associated contacts to read: ${contactIds.size}`);

  // Batch read contacts in chunks
  const contactProps = [
    "hs_analytics_last_touch_converting_campaign",
    "hs_analytics_first_touch_converting_campaign"
  ];

  const contactIdList = Array.from(contactIds);
  const contactCampaign = new Map(); // contactId -> campaignName (string)

  for (let i = 0; i < contactIdList.length; i += 100) {
    const chunk = contactIdList.slice(i, i + 100);
    const resp = await hsFetch(`/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      body: JSON.stringify({
        properties: contactProps,
        inputs: chunk.map(id => ({ id })),
      }),
    });

    for (const c of resp.results || []) {
      const p = c.properties || {};
      const last = (p.hs_analytics_last_touch_converting_campaign || "").trim();
      const first = (p.hs_analytics_first_touch_converting_campaign || "").trim();
      const name = last || first || "";
      if (name) contactCampaign.set(c.id, name);
    }
  }

  // 4) Attribute deals -> campaign_name and build:
  //    campaign -> deal_ids list
  //    campaign -> revenue_by_dealtype
  //    campaign -> deals_won_by_dealtype
  const campaignDealIds = new Map();           // campaignName -> Set(dealId)
  const campaignRevenueByType = new Map();     // campaignName -> Map(dealtype -> number)
  const campaignWonCountByType = new Map();    // campaignName -> Map(dealtype -> number)
  const unmatchedDeals = [];

  for (const d of deals) {
    const contactId = dealToPrimaryContact.get(d.id);
    const campaignName = contactId ? contactCampaign.get(contactId) : null;

    if (!campaignName) {
      unmatchedDeals.push(d.id);
      continue;
    }

    const dealtype = ((d.properties && d.properties.dealtype) ? String(d.properties.dealtype) : "Unknown").trim() || "Unknown";
    const amount = Number(d.properties && d.properties.amount ? d.properties.amount : 0) || 0;
    const isWon = String(d.properties && d.properties.hs_is_closed_won ? d.properties.hs_is_closed_won : "false").toLowerCase() === "true";

    if (!campaignDealIds.has(campaignName)) campaignDealIds.set(campaignName, new Set());
    campaignDealIds.get(campaignName).add(d.id);

    if (!campaignRevenueByType.has(campaignName)) campaignRevenueByType.set(campaignName, new Map());
    if (!campaignWonCountByType.has(campaignName)) campaignWonCountByType.set(campaignName, new Map());

    if (isWon) {
      campaignRevenueByType.get(campaignName).set(
        dealtype,
        (campaignRevenueByType.get(campaignName).get(dealtype) || 0) + amount
      );
      campaignWonCountByType.get(campaignName).set(
        dealtype,
        (campaignWonCountByType.get(campaignName).get(dealtype) || 0) + 1
      );
    }
  }

  // 5) Write into Postgres by matching campaign_name
  let updated = 0;
  let missingCampaignRows = 0;

  for (const [campaignName, idSet] of campaignDealIds.entries()) {
    const dealIdsJson = JSON.stringify(Array.from(idSet));
    const revenueMap = campaignRevenueByType.get(campaignName) || new Map();
    const wonMap = campaignWonCountByType.get(campaignName) || new Map();

    const revenueObj = {};
    for (const [k, v] of revenueMap.entries()) revenueObj[k] = Number(v.toFixed(2));
    const wonObj = {};
    for (const [k, v] of wonMap.entries()) wonObj[k] = v;

    const res = await pool.query(
      `
      update campaign_context_snapshot_90d
      set deal_ids_90d = $1::jsonb,
          revenue_by_dealtype_90d = $2::jsonb,
          deals_won_by_dealtype_90d = $3::jsonb
      where campaign_name = $4
      `,
      [dealIdsJson, JSON.stringify(revenueObj), JSON.stringify(wonObj), campaignName]
    );

    if (res.rowCount > 0) updated += res.rowCount;
    else missingCampaignRows += 1;
  }

  console.log(`Snapshot rows updated with deal_ids_90d: ${updated}`);
  console.log(`Campaign names from contacts with no matching row in snapshot: ${missingCampaignRows}`);
  console.log(`Deals with no campaign attribution (no converting campaign found): ${unmatchedDeals.length}`);

  await pool.end();
})().catch(e => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
