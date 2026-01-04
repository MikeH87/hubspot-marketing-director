/**
 * Ingest HubSpot Leads into Postgres (lead_facts_raw) using time-sliced windows.
 *
 * Why: avoids deep pagination caps (often ~10k results) on CRM search endpoints.
 *
 * Usage:
 *   node tools/ingest-leads-90d.js                    # default 90 days, daily slices
 *   node tools/ingest-leads-90d.js --days 7           # last 7 days
 *   node tools/ingest-leads-90d.js --days 30 --sliceDays 3
 *   node tools/ingest-leads-90d.js --days 7 --maxPages 2   # limit per-slice pages for testing
 */
const { Client } = require("pg");

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;

if (!HUBSPOT_TOKEN) { console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN"); console.log("STEP10D_FAILED"); process.exit(1); }
if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)"); console.log("STEP10D_FAILED"); process.exit(1); }

const HEADERS_JSON = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };
const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}` };

function argNum(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const DAYS = argNum("--days", 90);
const SLICE_DAYS = argNum("--sliceDays", 1);
const MAX_PAGES = argNum("--maxPages", 0);   // 0 = unlimited per slice

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return json;
}

async function postJSON(url, body) {
  const res = await fetch(url, { method: "POST", headers: HEADERS_JSON, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return json;
}

function toIso(val, fallbackIso) {
  if (val === undefined || val === null) return fallbackIso;
  if (typeof val === "string" && val.includes("T")) {
    const d = new Date(val);
    return isNaN(d.getTime()) ? fallbackIso : d.toISOString();
  }
  const n = Number(val);
  if (!Number.isFinite(n)) return fallbackIso;
  const d = new Date(n);
  return isNaN(d.getTime()) ? fallbackIso : d.toISOString();
}

async function getValidLeadPropertyNames() {
  const j = await fetchJSON("https://api.hubapi.com/crm/v3/properties/leads");
  return new Set((j.results || []).map(r => r.name));
}

function startOfDayUtc(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function main() {
  const now = new Date();
  const endMs = startOfDayUtc(now) + 24 * 60 * 60 * 1000; // end at next midnight UTC
  const startMs = endMs - DAYS * 24 * 60 * 60 * 1000;

  const desired = [
    "hs_createdate",
    "hs_lastmodifieddate",
    "hs_lead_disqualification_reason",
    "hubspot_owner_id",
    "hs_owner_id",
    "hs_lead_status",
    "hs_lead_stage",
    "lead_status",
    "lead_stage"
  ];

  const validNames = await getValidLeadPropertyNames();
  const properties = desired.filter(x => validNames.has(x));

  const modifiedFieldCandidates = ["hs_lastmodifieddate", "lastmodifieddate", "hs_lastmodified_date"];
  const modifiedField = modifiedFieldCandidates.find(x => validNames.has(x)) || "hs_lastmodifieddate";

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  let total = 0;
  let slices = 0;
  let pagesTotal = 0;

  for (let sliceStart = startMs; sliceStart < endMs; sliceStart += SLICE_DAYS * 24 * 60 * 60 * 1000) {
    const sliceEnd = Math.min(endMs, sliceStart + SLICE_DAYS * 24 * 60 * 60 * 1000);
    slices++;

    let after = 0;
    let pages = 0;

    while (true) {
      if (MAX_PAGES > 0 && pages >= MAX_PAGES) break;

      const body = {
        filterGroups: [
          {
            filters: [
              { propertyName: modifiedField, operator: "GTE", value: String(sliceStart) },
              { propertyName: modifiedField, operator: "LT", value: String(sliceEnd) }
            ]
          }
        ],
        sorts: [{ propertyName: modifiedField, direction: "ASCENDING" }],
        properties,
        limit: 100,
        after
      };

      const j = await postJSON("https://api.hubapi.com/crm/v3/objects/leads/search", body);
      const results = j.results || [];

      pages++;
      pagesTotal++;
      console.log(`Slice ${new Date(sliceStart).toISOString().slice(0,10)} → ${new Date(sliceEnd).toISOString().slice(0,10)} | Page ${pages} | ${results.length} leads`);

      for (const r of results) {
        total++;
        const p = r.properties || {};

        const lead_id = String(r.id);
        const created_at = toIso(p.hs_createdate, (r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString()));
        const updated_at = toIso(p.hs_lastmodifieddate, (r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString()));

        const lead_status = p.hs_lead_status || p.lead_status || null;
        const lead_stage  = p.hs_lead_stage  || p.lead_stage  || null;
        const owner_id = p.hubspot_owner_id || p.hs_owner_id || null;
        const disq = p.hs_lead_disqualification_reason || null;

        await client.query(
          `
          INSERT INTO lead_facts_raw
            (lead_id, created_at, updated_at, lead_status, lead_stage, owner_id, disqualification_reason)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (lead_id) DO UPDATE SET
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            lead_status = EXCLUDED.lead_status,
            lead_stage = EXCLUDED.lead_stage,
            owner_id = EXCLUDED.owner_id,
            disqualification_reason = EXCLUDED.disqualification_reason;
          `,
          [lead_id, created_at, updated_at, lead_status, lead_stage, owner_id, disq]
        );
      }

      if (!j.paging || !j.paging.next || !j.paging.next.after) break;
      after = j.paging.next.after;
    }
  }

  const verify = await client.query(
    "SELECT COUNT(*)::int AS c FROM lead_facts_raw WHERE updated_at >= NOW() - interval '90 days'"
  );

  await client.end();

  console.log("=== INGEST LEADS (SLICED) ===");
  console.log(`Days window: ${DAYS}`);
  console.log(`Slice size (days): ${SLICE_DAYS}`);
  console.log(`Slices: ${slices}`);
  console.log(`Pages fetched: ${pagesTotal}`);
  console.log(`Leads upserted (loop count): ${total}`);
  console.log(`Rows in DB updated in last 90d: ${verify.rows[0].c}`);
  console.log("STEP10D_OK");
}

main().catch(err => {
  console.error(err);
  console.log("STEP10D_FAILED");
  process.exit(1);
});
