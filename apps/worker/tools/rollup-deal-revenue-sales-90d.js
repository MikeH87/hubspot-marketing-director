const { Pool } = require("pg");
require("dotenv").config({ path: __dirname + "/../.env.local" });
const { hsPost } = require("../../../packages/hubspot/client");

function moneyToNumber(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function normaliseId(x) { const s = String(x ?? "").trim(); return s ? s : null; }

function parseWonStages() {
  const raw = process.env.SALES_PIPELINE_WON_STAGES || "1054943521";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
const EXCLUDED_DEALTYPES = new Set(
  (process.env.EXCLUDED_DEALTYPES || "SSAS,FIC").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
);
function isExcludedDealtype(t) { return EXCLUDED_DEALTYPES.has(String(t || "").trim().toLowerCase()); }
function chunk(arr, size) { const out=[]; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function inWindow(iso, start, end) {
  if (!iso) return false;
  const t = Date.parse(iso);
  const a = Date.parse(start);
  const b = Date.parse(end);
  return Number.isFinite(t) && Number.isFinite(a) && Number.isFinite(b) && t >= a && t <= b;
}

async function hubspotBatchReadDeals(dealIds) {
  const props = ["dealtype", "dealstage", "amount", "createdate", "closedate"];
  const dealInfo = new Map();

  for (const ids of chunk(dealIds, 100)) {
    const body = { inputs: ids.map(id => ({ id: String(id) })), properties: props };
    const j = await hsPost("/crm/v3/objects/deals/batch/read", body);
    for (const d of (j?.results || [])) {
      const id = normaliseId(d.id);
      if (!id) continue;
      const p = d.properties || {};
      const dealtype = (String(p.dealtype || "Unknown").trim() || "Unknown");
      if (isExcludedDealtype(dealtype)) continue;

      dealInfo.set(id, {
        dealstage: String(p.dealstage || "").trim(),
        amount: moneyToNumber(p.amount),
        createdate: p.createdate || null,
        closedate: p.closedate || null
      });
    }
  }
  return dealInfo;
}

(async () => {
  const dbUrl = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!dbUrl) { console.log("Missing DATABASE_URL (or RENDER_DATABASE_URL)."); process.exit(1); }
  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  const { rows: winRows } = await pool.query(`
    SELECT window_start, window_end
    FROM campaign_context_snapshot_90d
    ORDER BY window_end DESC, captured_at DESC
    LIMIT 1;
  `);
  if (!winRows.length) { console.log("No snapshot windows found."); await pool.end(); process.exit(1); }

  const windowStart = winRows[0].window_start;
  const windowEnd = winRows[0].window_end;

  const snap = await pool.query(`
    SELECT id, deal_ids_90d
    FROM campaign_context_snapshot_90d
    WHERE window_start=$1 AND window_end=$2 AND deal_ids_90d IS NOT NULL
  `, [windowStart, windowEnd]);

  const allDealIds = new Set();
  const snapDealMap = new Map();

  for (const r of snap.rows) {
    let parsed = r.deal_ids_90d;
    if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { parsed = null; } }

    let ids = [];
    if (Array.isArray(parsed)) ids = parsed;
    else if (parsed?.dealIds && Array.isArray(parsed.dealIds)) ids = parsed.dealIds;

    const norm = ids.map(normaliseId).filter(Boolean);
    snapDealMap.set(r.id, norm);
    for (const id of norm) allDealIds.add(id);
  }

  const dealIdsArr = Array.from(allDealIds);
  console.log("Deals to evaluate:", dealIdsArr.length);

  const dealInfo = await hubspotBatchReadDeals(dealIdsArr);
  console.log("Deals fetched (after exclusions):", dealInfo.size);

  const wonStages = new Set(parseWonStages());
  let updated = 0;

  for (const [snapId, ids] of snapDealMap.entries()) {
    let pipelineCreated = 0;
    let revenueWon = 0;
    let dealsCreatedCount = 0;
    let dealsWonCount = 0;

    for (const dealId of ids) {
      const info = dealInfo.get(dealId);
      if (!info) continue;

      if (inWindow(info.createdate, windowStart, windowEnd)) {
        pipelineCreated += info.amount;
        dealsCreatedCount += 1;
      }
      if (wonStages.has(info.dealstage) && inWindow(info.closedate, windowStart, windowEnd)) {
        revenueWon += info.amount;
        dealsWonCount += 1;
      }
    }

    await pool.query(`
      UPDATE campaign_context_snapshot_90d
      SET pipeline_created_90d_sales = $1,
          revenue_won_90d_sales = $2,
          deals_created_90d_sales = $3,
          deals_won_90d_sales = $4
      WHERE id = $5
    `, [pipelineCreated, revenueWon, dealsCreatedCount, dealsWonCount, snapId]);

    updated += 1;
  }

  console.log("Updated snapshot rows:", updated);
  console.log("STEP14C1_OK");
  await pool.end();
})().catch(e => { console.error(e); console.log("STEP14C1_FAILED"); process.exit(1); });
