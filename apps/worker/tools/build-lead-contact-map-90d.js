/**
 * Step 11B (fixed): Build Lead → Contact map using HubSpot v3 batch associations
 */
const { Client } = require("pg");

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;

if (!HUBSPOT_TOKEN) { console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN"); console.log("STEP11B_FAILED"); process.exit(1); }
if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)"); console.log("STEP11B_FAILED"); process.exit(1); }

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };

async function postJSON(url, body) {
  const res = await fetch(url, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return json;
}

async function main() {
  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const q = await client.query(
    "SELECT lead_id FROM lead_facts_raw WHERE updated_at >= NOW() - interval '90 days' ORDER BY updated_at DESC"
  );
  const leadIds = q.rows.map(r => String(r.lead_id));

  let totalLeads = leadIds.length;
  let leadsWithContacts = 0;
  let mappedPairs = 0;

  const BATCH = 100;

  for (let i = 0; i < leadIds.length; i += BATCH) {
    const chunk = leadIds.slice(i, i + BATCH);
    const body = { inputs: chunk.map(id => ({ id })) };

    const url = "https://api.hubapi.com/crm/v3/associations/leads/contacts/batch/read";
    const j = await postJSON(url, body);

    const results = j.results || [];
    for (const r of results) {
      const fromId = String(r.from?.id || "");
      const tos = r.to || [];
      if (tos.length > 0) leadsWithContacts++;

      for (const t of tos) {
        const toId = String(t.id || "");
        if (!fromId || !toId) continue;
        mappedPairs++;

        await client.query(
          "INSERT INTO lead_contact_map (lead_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [fromId, toId]
        );
      }
    }

    if ((i / BATCH) % 10 === 0) {
      console.log(`Progress: ${Math.min(i + BATCH, totalLeads)}/${totalLeads} leads processed`);
    }
  }

  const verify = await client.query("SELECT COUNT(*)::int AS c FROM lead_contact_map");

  await client.end();

  console.log("=== LEAD→CONTACT MAP BUILDER ===");
  console.log(`Leads considered (90d): ${totalLeads}`);
  console.log(`Leads with ≥1 contact: ${leadsWithContacts}`);
  console.log(`Associations inserted (attempted): ${mappedPairs}`);
  console.log(`Rows in lead_contact_map: ${verify.rows[0].c}`);
  console.log("STEP11B_OK");
}

main().catch(err => {
  console.error(err);
  console.log("STEP11B_FAILED");
  process.exit(1);
});
