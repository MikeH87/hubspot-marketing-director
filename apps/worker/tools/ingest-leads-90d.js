/**
 * Ingest HubSpot Leads into Postgres (lead_facts_raw)
 * - Pulls last 90 days by lastmodifieddate (captures resets/updates)
 * - Upserts by lead_id
 */
const { Client } = require("pg");

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;

if (!HUBSPOT_TOKEN) { console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN"); console.log("STEP10C_FAILED"); process.exit(1); }
if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)"); console.log("STEP10C_FAILED"); process.exit(1); }

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return json;
}

async function getValidLeadPropertyNames() {
  // Leads properties endpoint (we already proved this works in STEP10A)
  const j = await fetchJSON("https://api.hubapi.com/crm/v3/properties/leads");
  const names = new Set((j.results || []).map(r => r.name));
  return names;
}

async function postJSON(url, body) {
  const res = await fetch(url, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return json;
}

function toIso(val, fallbackIso) {
  if (val === undefined || val === null) return fallbackIso;
  // If it's already an ISO-ish string, try it directly
  if (typeof val === "string" && val.includes("T")) {
    const d = new Date(val);
    return isNaN(d.getTime()) ? fallbackIso : d.toISOString();
  }
  // Try numeric epoch millis
  const n = Number(val);
  if (!Number.isFinite(n)) return fallbackIso;
  const d = new Date(n);
  return isNaN(d.getTime()) ? fallbackIso : d.toISOString();
}

async function main() {
  const DAYS = 90;
  const sinceMs = Date.now() - DAYS*24*60*60*1000;

  // We'll ask for a broad set of likely properties and keep whichever exist.
  // (HubSpot will ignore unknown properties in the response, but search requires valid property names in 'properties'.)
  // From your discovery, hs_lead_disqualification_reason exists.
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

  // Choose a valid "modified date" field for filtering/sorting
  const modifiedFieldCandidates = ["hs_lastmodifieddate", "lastmodifieddate", "hs_lastmodified_date"];
  const modifiedField = modifiedFieldCandidates.find(x => validNames.has(x)) || "hs_lastmodifieddate";


  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  let after = 0;
  let total = 0;

  while (true) {
    const body = {
      filterGroups: [
        { filters: [{ propertyName: modifiedField, operator: "GTE", value: String(sinceMs) }] }
      ],
      sorts: [{ propertyName: modifiedField, direction: "ASCENDING" }],
      properties,
      limit: 100,
      after
    };

    const j = await postJSON("https://api.hubapi.com/crm/v3/objects/leads/search", body);
    const results = j.results || [];
    console.log(`Page fetched: ${results.length} leads (after=${after || 0})`);

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

  const verify = await client.query(
    "SELECT COUNT(*)::int AS c FROM lead_facts_raw WHERE updated_at >= NOW() - interval '90 days'"
  );

  await client.end();

  console.log("=== INGEST LEADS ===");
  console.log(`Leads upserted (loop count): ${total}`);
  console.log(`Rows in DB updated in last 90d: ${verify.rows[0].c}`);
  console.log("STEP10C_OK");
}

main().catch(err => {
  console.error(err);
  console.log("STEP10C_FAILED");
  process.exit(1);
});
