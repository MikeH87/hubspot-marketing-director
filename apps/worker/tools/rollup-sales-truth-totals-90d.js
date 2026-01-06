/**
 * sales-truth-totals-90d.js (patched: batch contact reads in chunks of 100)
 */
require("dotenv").config({ path: ".env.local" });

const { Pool } = require("pg");

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;

const WON_STAGE_ID = "1054943521";
const WINDOW_DAYS = 90;
const NEW_PROSPECT_DAYS = 30;

const EXCLUDED_DEALTYPES = new Set(["SSAS", "FIC"]);

function need(name, v) { if (!v) throw new Error(`Missing ${name}`); }
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function parseMoney(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function parseIntSafe(v) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; }
function daysBetween(a, b) { return Math.floor((b.getTime() - a.getTime()) / (1000*60*60*24)); }

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function hsSearchDeals({ gteClosed, ltClosed, after }) {
  const url = "https://api.hubapi.com/crm/v3/objects/deals/search";
  const body = {
    limit: 100,
    after: after ?? undefined,
    filterGroups: [{
      filters: [
        { propertyName: "dealstage", operator: "EQ", value: WON_STAGE_ID },
        { propertyName: "closedate", operator: "GTE", value: String(gteClosed) },
        { propertyName: "closedate", operator: "LT",  value: String(ltClosed) }
      ]
    }],
    properties: ["amount", "total_no_of_sales", "dealtype", "pipeline", "dealstage", "createdate", "closedate"]
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`HubSpot deals search failed ${resp.status}: ${text.slice(0, 800)}`);
  return JSON.parse(text);
}

async function hsGetDealContacts(dealId) {
  const url = `https://api.hubapi.com/crm/v3/objects/deals/${dealId}/associations/contacts?limit=100`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, Accept: "application/json" }
  });
  const text = await resp.text();
  if (!resp.ok) return [];
  const json = JSON.parse(text);
  return (json.results || []).map(r => String(r.id));
}

async function hsBatchReadContactsChunk(contactIds) {
  const url = "https://api.hubapi.com/crm/v3/objects/contacts/batch/read";
  const body = {
    properties: ["createdate"],
    inputs: contactIds.map(id => ({ id: String(id) })),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`HubSpot contacts batch read failed ${resp.status}: ${text.slice(0, 800)}`);

  const json = JSON.parse(text);
  const m = new Map();
  for (const r of (json.results || [])) {
    const created = r.properties?.createdate ? new Date(r.properties.createdate) : null;
    m.set(String(r.id), created);
  }
  return m;
}

async function hsBatchReadContacts(contactIds) {
  const all = new Map();
  const batches = chunk(contactIds, 100);
  for (let i = 0; i < batches.length; i++) {
    const m = await hsBatchReadContactsChunk(batches[i]);
    for (const [k, v] of m.entries()) all.set(k, v);
  }
  return all;
}

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_truth_totals_90d (
      window_start_date DATE NOT NULL,
      window_end_date   DATE NOT NULL,
      deals_won_count   INT  NOT NULL,
      revenue_won       NUMERIC NOT NULL,
      units_sold        INT  NOT NULL,
      revenue_new_prospect NUMERIC NOT NULL,
      revenue_old_prospect NUMERIC NOT NULL,
      deals_missing_contact INT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (window_start_date, window_end_date)
    );
  `);
}

async function upsertTotals(pool, row) {
  await pool.query(
    `
    INSERT INTO sales_truth_totals_90d
      (window_start_date, window_end_date, deals_won_count, revenue_won, units_sold,
       revenue_new_prospect, revenue_old_prospect, deals_missing_contact, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT (window_start_date, window_end_date) DO UPDATE SET
      deals_won_count = EXCLUDED.deals_won_count,
      revenue_won = EXCLUDED.revenue_won,
      units_sold = EXCLUDED.units_sold,
      revenue_new_prospect = EXCLUDED.revenue_new_prospect,
      revenue_old_prospect = EXCLUDED.revenue_old_prospect,
      deals_missing_contact = EXCLUDED.deals_missing_contact,
      updated_at = NOW()
    `,
    [
      row.window_start_date,
      row.window_end_date,
      row.deals_won_count,
      row.revenue_won,
      row.units_sold,
      row.revenue_new_prospect,
      row.revenue_old_prospect,
      row.deals_missing_contact,
    ]
  );
}

async function main() {
  need("HUBSPOT_PRIVATE_APP_TOKEN", HUBSPOT_TOKEN);
  need("DATABASE_URL (or RENDER_DATABASE_URL)", DATABASE_URL);

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
  });

  await ensureTable(pool);

  const windowEnd = startOfDay(new Date());
  const windowStart = startOfDay(new Date(windowEnd));
  windowStart.setDate(windowStart.getDate() - WINDOW_DAYS);

  const gteClosed = windowStart.getTime();
  const ltClosed = windowEnd.getTime();

  let after = undefined;
  const deals = [];

  while (true) {
    const page = await hsSearchDeals({ gteClosed, ltClosed, after });
    for (const d of (page.results || [])) deals.push(d);
    if (!page.paging?.next?.after) break;
    after = page.paging.next.after;
  }

  const filtered = deals.filter(d => !EXCLUDED_DEALTYPES.has(String(d.properties?.dealtype || "").trim()));

  const dealToContacts = new Map();
  const allContactIds = new Set();

  for (const d of filtered) {
    const dealId = String(d.id);
    const cids = await hsGetDealContacts(dealId);
    dealToContacts.set(dealId, cids);
    for (const id of cids) allContactIds.add(String(id));
  }

  const contactIds = Array.from(allContactIds);
  const contactMap = await hsBatchReadContacts(contactIds);

  let dealsWon = 0;
  let revenueWon = 0;
  let unitsSold = 0;
  let revenueNew = 0;
  let revenueOld = 0;
  let missingContact = 0;

  for (const d of filtered) {
    const amount = parseMoney(d.properties?.amount);
    const units = parseIntSafe(d.properties?.total_no_of_sales);
    const closed = d.properties?.closedate ? new Date(d.properties.closedate) : null;

    dealsWon += 1;
    revenueWon += amount;
    unitsSold += units;

    const cids = dealToContacts.get(String(d.id)) || [];
    if (cids.length === 0 || !closed) {
      missingContact += 1;
      revenueOld += amount;
      continue;
    }

    const created = contactMap.get(String(cids[0])) || null;
    if (!created) {
      missingContact += 1;
      revenueOld += amount;
      continue;
    }

    const ageDays = daysBetween(created, closed);
    if (ageDays <= NEW_PROSPECT_DAYS) revenueNew += amount;
    else revenueOld += amount;
  }

  const row = {
    window_start_date: windowStart.toISOString().slice(0,10),
    window_end_date: windowEnd.toISOString().slice(0,10),
    deals_won_count: dealsWon,
    revenue_won: revenueWon,
    units_sold: unitsSold,
    revenue_new_prospect: revenueNew,
    revenue_old_prospect: revenueOld,
    deals_missing_contact: missingContact,
  };

  await upsertTotals(pool, row);

  console.log("=== SALES TRUTH TOTALS (90D, CLOSE DATE) ===");
  console.log(`Window: ${row.window_start_date} → ${row.window_end_date}`);
  console.log(`Deals won: ${row.deals_won_count}`);
  console.log(`Revenue won (amount): £${Math.round(row.revenue_won).toLocaleString("en-GB")}`);
  console.log(`Units sold (total_no_of_sales): ${row.units_sold}`);
  console.log(`Revenue from new prospects (<=30d): £${Math.round(row.revenue_new_prospect).toLocaleString("en-GB")}`);
  console.log(`Revenue from older/unknown prospects: £${Math.round(row.revenue_old_prospect).toLocaleString("en-GB")}`);
  console.log(`Deals missing contact createdate: ${row.deals_missing_contact}`);

  await pool.end();
}

main()
  .then(() => console.log("STEP15B_OK"))
  .catch((e) => {
    console.error(e);
    console.log("STEP15B_FAILED");
    process.exit(1);
  });
