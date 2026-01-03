require("dotenv").config();
const { Pool } = require("pg");

/**
 * Roll up dealtype → revenue and wins into campaign_context_snapshot_90d
 *
 * Expects:
 *  - campaign_context_snapshot_90d.deal_ids_90d (jsonb) to exist and contain an array of deal IDs (strings or numbers).
 * Writes:
 *  - revenue_by_dealtype_90d (jsonb) e.g. {"Product Sale": 18000, "Admin Sale": 0}
 *  - deals_won_by_dealtype_90d (jsonb) e.g. {"Product Sale": 3, "Admin Sale": 1}
 *
 * Notes:
 *  - Only counts deals in the rolling window already used when collecting deal_ids_90d.
 *  - Treats a deal as "won" if dealstage is in the SALES_PIPELINE_WON_STAGES env var (comma-separated),
 *    otherwise falls back to isClosed=true if present, else ignores win count.
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

function parseWonStages() {
  const raw = process.env.SALES_PIPELINE_WON_STAGES || "";
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function moneyToNumber(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const wonStages = new Set(parseWonStages());
  const haveWonStages = wonStages.size > 0;

  // 1) Load all campaigns that have deal_ids_90d populated
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

  // 2) Build set of all deal IDs referenced
  const campaignDealMap = new Map(); // snap_id -> array(dealIds)
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

  // 3) Pull deal properties for all referenced deals (chunked)
  // We depend only on CRM deal properties already proven: dealtype, dealstage, amount
  // If you want a different revenue field later, we can swap it (e.g., hs_closed_amount).
  const dealInfo = new Map(); // dealId -> { dealtype, dealstage, amount, isclosed }
  const chunkSize = 500;

  for (let i = 0; i < allIdsArr.length; i += chunkSize) {
    const chunk = allIdsArr.slice(i, i + chunkSize);

    const q = await pool.query(
      `
      select id,
             properties->>'dealtype'  as dealtype,
             properties->>'dealstage' as dealstage,
             properties->>'amount'    as amount,
             properties->>'hs_is_closed' as hs_is_closed,
             properties->>'isClosed'  as isClosed
      from deals
      where id = any($1::text[])
      `,
      [chunk]
    );

    for (const d of q.rows) {
      const id = normaliseId(d.id);
      if (!id) continue;

      const dealtype = (d.dealtype || "Unknown").trim() || "Unknown";
      const dealstage = (d.dealstage || "").trim();
      const amount = moneyToNumber(d.amount);

      // attempt to interpret closed/won
      const closedFlagRaw = (d.hs_is_closed ?? d.isclosed ?? d.isClosed);
      const isClosed = String(closedFlagRaw).toLowerCase() === "true";

      dealInfo.set(id, { dealtype, dealstage, amount, isClosed });
    }
  }

  // 4) Roll up per campaign snapshot row
  let updated = 0;

  for (const [snapId, ids] of campaignDealMap.entries()) {
    const revenueByType = {};
    const winsByType = {};

    for (const dealId of ids) {
      const info = dealInfo.get(dealId);
      if (!info) continue;

      const t = info.dealtype || "Unknown";
      revenueByType[t] = (revenueByType[t] || 0) + info.amount;

      let isWon = false;
      if (haveWonStages) {
        isWon = wonStages.has(info.dealstage);
      } else {
        // fallback only if we have no stage config
        isWon = info.isClosed === true;
      }

      if (isWon) {
        winsByType[t] = (winsByType[t] || 0) + 1;
      }
    }

    await pool.query(
      `
      update campaign_context_snapshot_90d
      set revenue_by_dealtype_90d = $1::jsonb,
          deals_won_by_dealtype_90d = $2::jsonb
      where id = $3
      `,
      [JSON.stringify(revenueByType), JSON.stringify(winsByType), snapId]
    );

    updated += 1;
  }

  console.log(`Rollup complete. Updated ${updated} campaign snapshot rows.`);
  await pool.end();
})().catch(err => {
  console.error("FAILED:", err && err.stack ? err.stack : err);
  process.exit(1);
});
