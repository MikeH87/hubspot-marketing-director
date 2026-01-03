require("dotenv").config();
const { Pool } = require("pg");

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const DB = process.env.DATABASE_URL;

if (!HUBSPOT_TOKEN) throw new Error("Missing HUBSPOT_PRIVATE_APP_TOKEN in .env");
if (!DB) throw new Error("Missing DATABASE_URL in .env");

const pool = new Pool({
  connectionString: DB,
  ssl: { rejectUnauthorized: false },
});

async function hsFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HubSpot ${url} -> ${res.status} ${res.statusText} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function hsBatchReadDeals(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const out = new Map();

  for (const chunk of chunks) {
    const body = {
      properties: ["dealtype", "amount", "closedate", "hs_is_closed_won", "pipeline", "dealstage", "dealname"],
      inputs: chunk.map((id) => ({ id: String(id) })),
    };
    const j = await hsFetch("https://api.hubapi.com/crm/v3/objects/deals/batch/read", {
      method: "POST",
      body: JSON.stringify(body),
    });

    for (const d of j.results || []) out.set(String(d.id), d.properties || {});
  }
  return out;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function addTo(obj, key, val) {
  obj[key] = (obj[key] || 0) + val;
}

async function main() {
  // Prefer filtered table if present
  const tableCandidates = ["campaign_context_snapshot_90d_filtered", "campaign_context_snapshot_90d"];
  let table = null;

  for (const t of tableCandidates) {
    const exists = await pool.query(
      `select 1 from information_schema.tables where table_schema='public' and table_name=$1`,
      [t]
    );
    if (exists.rowCount) { table = t; break; }
  }
  if (!table) throw new Error("Could not find campaign_context_snapshot_90d(_filtered) in the database.");

  // Try to find a deal IDs column we can use
  const cols = await pool.query(
    `select column_name, data_type
     from information_schema.columns
     where table_schema='public' and table_name=$1
     order by ordinal_position`,
    [table]
  );

  const colNames = cols.rows.map(r => r.column_name);

  const dealIdColCandidates = [
    "deal_ids_90d",
    "deal_ids",
    "deals_90d_ids",
    "deal_ids_sales_90d",
    "deal_ids_sales",
    "deals_json",
    "deals_90d",
    "deals",
  ];

  const dealIdCol = dealIdColCandidates.find(c => colNames.includes(c));
  if (!dealIdCol) {
    throw new Error(
      `Could not find a deals id column on ${table}. I looked for: ${dealIdColCandidates.join(", ")}\n` +
      `Columns found: ${colNames.join(", ")}`
    );
  }

  // Add roll-up columns if missing
  const ensureCols = [
    { name: "won_count_by_dealtype_90d", type: "jsonb" },
    { name: "won_revenue_by_dealtype_90d", type: "jsonb" },
    { name: "all_count_by_dealtype_90d", type: "jsonb" },
  ];

  for (const c of ensureCols) {
    if (!colNames.includes(c.name)) {
      await pool.query(`alter table ${table} add column if not exists ${c.name} ${c.type} default '{}'::jsonb`);
    }
  }

  // Pull snapshot rows (campaign_id + deal ids column)
  const rows = await pool.query(`select campaign_id, ${dealIdCol} as deal_ids from ${table}`);
  const campaignRows = rows.rows;

  // Collect all deal IDs
  const allDealIds = new Set();

  function extractIds(v) {
    if (!v) return [];
    // Could be array, jsonb, stringified json, or comma-separated text
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "object") {
      // Some shapes might store {ids:[...]} or [{id:...}, ...]
      if (Array.isArray(v.ids)) return v.ids.map(String);
      if (Array.isArray(v.deals)) return v.deals.map(d => String(d.id || d));
      return [];
    }
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return [];
      try {
        const j = JSON.parse(s);
        return extractIds(j);
      } catch {
        // comma-separated fallback
        return s.split(",").map(x => x.trim()).filter(Boolean);
      }
    }
    return [];
  }

  const perCampaignIds = new Map();
  for (const r of campaignRows) {
    const ids = extractIds(r.deal_ids).map(String).filter(Boolean);
    perCampaignIds.set(String(r.campaign_id), ids);
    for (const id of ids) allDealIds.add(id);
  }

  const allIdsArr = Array.from(allDealIds);
  console.log(`Table: ${table}`);
  console.log(`Using deal id column: ${dealIdCol}`);
  console.log(`Campaign rows: ${campaignRows.length}`);
  console.log(`Unique deal ids referenced: ${allIdsArr.length}`);

  if (allIdsArr.length === 0) {
    console.log("No deal ids found in snapshot rows. Nothing to roll up.");
    await pool.end();
    return;
  }

  // Fetch deal details in batches
  const dealMap = await hsBatchReadDeals(allIdsArr);

  // Build per-campaign rollups and write back
  let updated = 0;
  for (const [campaignId, ids] of perCampaignIds.entries()) {
    const allCount = {};
    const wonCount = {};
    const wonRevenue = {};

    for (const id of ids) {
      const p = dealMap.get(String(id));
      if (!p) continue;

      const dt = (p.dealtype || "Unknown").trim() || "Unknown";
      addTo(allCount, dt, 1);

      const isWon = String(p.hs_is_closed_won).toLowerCase() === "true";
      if (isWon) {
        addTo(wonCount, dt, 1);
        addTo(wonRevenue, dt, safeNum(p.amount));
      }
    }

    await pool.query(
      `update ${table}
       set all_count_by_dealtype_90d = $2::jsonb,
           won_count_by_dealtype_90d = $3::jsonb,
           won_revenue_by_dealtype_90d = $4::jsonb
       where campaign_id = $1`,
      [campaignId, JSON.stringify(allCount), JSON.stringify(wonCount), JSON.stringify(wonRevenue)]
    );

    updated++;
  }

  console.log(`Updated campaigns: ${updated}`);
  console.log("Done.");

  await pool.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
