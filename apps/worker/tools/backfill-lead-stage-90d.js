require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_PRIVATE_APP_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") || DATABASE_URL.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

async function hsBatchReadLeads(leadIds) {
  const url = "https://api.hubapi.com/crm/v3/objects/leads/batch/read";
  const body = {
    properties: ["hs_pipeline_stage"],
    inputs: leadIds.map((id) => ({ id: String(id) })),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) {
    console.error("HubSpot batch read failed:", resp.status, text.slice(0, 2000));
    process.exit(1);
  }
  return JSON.parse(text);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const days = 90;

  const idsRes = await pool.query(
    `select lead_id
     from lead_facts_raw
     where created_at >= now() - ($1::int * interval '1 day')
     order by lead_id asc`,
    [days]
  );

  const leadIds = idsRes.rows.map((r) => r.lead_id);
  console.log("=== BACKFILL LEAD STAGE (90D) ===");
  console.log("Lead IDs found in DB:", leadIds.length);

  let updated = 0;
  let withStage = 0;

  const batches = chunk(leadIds, 100);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const data = await hsBatchReadLeads(batch);

    // Build (lead_id, lead_stage) pairs
    const pairs = (data.results || []).map((r) => {
      const stage = r.properties?.hs_pipeline_stage ?? null;
      if (stage) withStage++;
      return { id: r.id, stage };
    });

    // Update using VALUES
    const valuesSql = pairs
      .map((_, idx) => `($${idx * 2 + 1}::text, $${idx * 2 + 2}::text)`)
      .join(",");

    const params = [];
    for (const p of pairs) {
      params.push(String(p.id));
      params.push(p.stage);
    }

    const sql = `
      update lead_facts_raw l
      set lead_stage = v.stage
      from (values ${valuesSql}) as v(id, stage)
      where l.lead_id::text = v.id::text
    `;

    const r = await pool.query(sql, params);
    updated += r.rowCount;

    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      console.log(`Progress: ${Math.min((i + 1) * 100, leadIds.length)}/${leadIds.length} lead IDs processed`);
    }
  }

  // Quick distribution check
  const dist = await pool.query(
    `select coalesce(lead_stage,'(null)') as lead_stage, count(*)::int as n
     from lead_facts_raw
     where created_at >= now() - ($1::int * interval '1 day')
     group by 1
     order by n desc`,
    [days]
  );

  console.log("Rows updated:", updated);
  console.log("Leads with non-null stage returned from HubSpot:", withStage);
  console.log("--- Stage distribution (90d) ---");
  for (const r of dist.rows) {
    console.log(`- ${r.lead_stage}: ${r.n}`);
  }

  console.log("STEP16C_OK");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  console.log("STEP16C_FAILED");
  process.exit(1);
});
