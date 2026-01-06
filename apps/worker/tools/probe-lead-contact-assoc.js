const { Client } = require("pg");

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;

if (!HUBSPOT_TOKEN) { console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN"); console.log("STEP11B1_FAILED"); process.exit(1); }
if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)"); console.log("STEP11B1_FAILED"); process.exit(1); }

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };

async function getLeadId() {
  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  const q = await client.query("SELECT lead_id FROM lead_facts_raw ORDER BY updated_at DESC LIMIT 1");
  await client.end();
  if (!q.rows.length) throw new Error("No leads in lead_facts_raw");
  return String(q.rows[0].lead_id);
}

async function probe(url, method, body) {
  try {
    const res = await fetch(url, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const snippet = text.slice(0, 180).replace(/\s+/g, " ");
    console.log(`${res.status} | ${method} ${url} | ${snippet}`);
  } catch (e) {
    console.log(`ERR | ${method} ${url} | ${e.message}`);
  }
}

(async function main(){
  const leadId = await getLeadId();
  console.log("Using lead_id:", leadId);

  // Single-lead association GET probes
  await probe(`https://api.hubapi.com/crm/v3/objects/leads/${leadId}/associations/contacts?limit=10`, "GET");
  await probe(`https://api.hubapi.com/crm/v4/objects/leads/${leadId}/associations/contacts?limit=10`, "GET");

  // Batch probes (various likely paths)
  const body = { inputs: [{ id: leadId }] };

  await probe("https://api.hubapi.com/crm/v4/objects/leads/contacts/batch/read", "POST", body);
  await probe("https://api.hubapi.com/crm/v4/objects/lead/contacts/batch/read", "POST", body);
  await probe("https://api.hubapi.com/crm/v3/associations/leads/contacts/batch/read", "POST", body);
  await probe("https://api.hubapi.com/crm/v3/associations/lead/contacts/batch/read", "POST", body);

  console.log("STEP11B1_OK");
})().catch(e => {
  console.error(e);
  console.log("STEP11B1_FAILED");
  process.exit(1);
});
