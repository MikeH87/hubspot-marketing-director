require("dotenv").config({ path: __dirname + "/../.env" });

const { Pool } = require("pg");
const { hsPost } = require("../../../packages/hubspot/client");

/**
 * Roll up dealtype -> revenue + won counts into campaign_context_snapshot_90d.
 *
 * Requires:
 *  - campaign_context_snapshot_90d.deal_ids_90d (jsonb array of deal IDs)
 *
 * Writes:
 *  - revenue_by_dealtype_90d (jsonb map)
 *  - deals_won_by_dealtype_90d (jsonb map)
 *
 * Win logic:
 *  - If SALES_PIPELINE_WON_STAGES env var is set (comma-separated dealstage values), uses that.
 *  - Else falls back to hs_is_closed / isClosed boolean.
 */

function parseJsonSafe(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

function normaliseId(x) {
  if (x == null) return null;
  const s = String(x).trim();
  return s.length ? s : null;
}

function moneyToNumber(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseWonStages() {
  const raw = process.env.SALES_PIPELINE_WON_STAGES || "";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function hubspotBatchReadDeals(dealIds) {
  // Returns Map(dealId -> { dealtype, dealstage, amount, isClosed })
  const dealInfo = new Map();

  const props = ["dealtype", "dealstage", "amount", "hs_is_closed", "isClosed"];
  const batches = chunk(dealIds, 100);

  for (const ids of batches) {
    const body = {
      inputs: ids.map(id => ({ id: String(id) })),
      properties: props,
    };

    const j = await hsPost("/crm/v3/objects/deals/batch/read", body);
    const results = (j && j.results) ? j.results : [];

    for (const d of results) {
      const id = normaliseId(d.id);
      if (!id) continue;

      const p = d.properties || {};
      const dealtype = (String(p.dealtype || "Unknown").trim() || "Unknown");
      const dealstage = String(p.dealstage || "").trim();
      const amount = moneyToNumber(p.amount);

      const closedRaw = (p.hs_is_closed != null) ? p.hs_is_closed : p.isClosed;
      const isClosed = String(closedRaw).toLowerCase() === "true";

      dealInfo.set(id, { dealtype, dealstage, amount, isClosed });
    }
  }

  return dealInfo;
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // 1) Load all snapshot rows with deal IDs
  const snapRows = await pool.query(`
    select id, campaign_id, campaign_name, deal_ids_90d
    from campaign_context_snapshot_90d
    where deal_ids_90d is not null
  `);

  if (snapRows.rowCount === 0) {
    console.log("No rows found with deal_ids_90d set. Nothing to roll up.");
    await pool.end();
    return;
  }

  // 2) Build mapping snap_id -> dealIds; and set of all deal IDs
  const campaignDealMap = new Map();
  const allDealIds = new Set();

  for (const r of snapRows.rows) {
    const parsed = parseJsonSafe(r.deal_ids_90d);
    let ids = [];

    if (Array.isArray(parsed)) ids = parsed;
    else if (parsed && Array.isArray(parsed.dealIds)) ids = parsed.dealIds;
    else if (parsed && Array.isArray(parsed.deals)) ids = parsed.deals;

    const norm = ids.map(normaliseId).filter(Boolean);
    campaignDealMap.set(r.id, norm);

    for (const id of norm) allDealIds.add(id);
  }

  const allIdsArr = Array.from(allDealIds);
  if (allIdsArr.length === 0) {
    console.log("deal_ids_90d exists but contains no IDs. Nothing to roll up.");
    await pool.end();
    return;
  }

  console.log("Total unique deal IDs to roll up: " + allIdsArr.length);

  // 3) Fetch deal properties from HubSpot (no DB deals table)
  const dealInfo = await hubspotBatchReadDeals(allIdsArr);
  console.log("Deal records fetched from HubSpot: " + dealInfo.size);

  // 4) Roll up per snapshot row and write back
  const wonStages = new Set(parseWonStages());
  const haveWonStages = wonStages.size > 0;

  let updated = 0;
  let totalRowCount = 0;

  for (const [snapId, ids] of campaignDealMap.entries()) {
    const revenueByType = {};
    const winsByType = {};

    for (const dealId of ids) {
      const info = dealInfo.get(dealId);
      if (!info) continue;

      const t = info.dealtype || "Unknown";
      revenueByType[t] = (revenueByType[t] || 0) + info.amount;

      let isWon = false;
      if (haveWonStages) isWon = wonStages.has(info.dealstage);
      else isWon = info.isClosed === true;

      if (isWon) winsByType[t] = (winsByType[t] || 0) + 1;
    }

    const res = await pool.query(
      `
      update campaign_context_snapshot_90d
      set revenue_by_dealtype_90d = $1::jsonb,
          deals_won_by_dealtype_90d = $2::jsonb
      where id = $3
      `,
      [JSON.stringify(revenueByType), JSON.stringify(winsByType), snapId]
    );

    updated += 1;
    totalRowCount += res.rowCount || 0;
  }

  console.log("Rollup complete. Updated " + updated + " snapshot rows. SQL rowCount sum: " + totalRowCount);
  await pool.end();
})().catch(err => {
  console.error("FAILED:", err && err.stack ? err.stack : err);
  process.exit(1);
});
