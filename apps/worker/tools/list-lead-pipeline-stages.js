/**
 * List Lead pipeline stages from HubSpot so we can map hs_pipeline_stage IDs with certainty.
 * Requires: HUBSPOT_PRIVATE_APP_TOKEN in .env.local
 */
require("dotenv").config({ path: ".env.local" });

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN in .env.local");
  process.exit(1);
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await r.text();
  if (!r.ok) {
    console.error("HTTP", r.status, text.slice(0, 2000));
    process.exit(1);
  }
  return JSON.parse(text);
}

async function main() {
  // Lead pipelines endpoint
  const url = "https://api.hubapi.com/crm/v3/pipelines/leads";
  const json = await fetchJson(url);

  console.log("=== LEAD PIPELINES ===");
  console.log("Pipelines:", (json.results || []).length);

  for (const p of (json.results || [])) {
    console.log("\n--- Pipeline ---");
    console.log("label:", p.label);
    console.log("id:", p.id);
    console.log("stages:", (p.stages || []).length);

    for (const s of (p.stages || [])) {
      console.log(`- ${s.label} | stageId=${s.id} | displayOrder=${s.displayOrder}`);
    }
  }

  console.log("\nSTEP16A_OK");
}

main().catch((e) => {
  console.error(e);
  console.log("STEP16A_FAILED");
  process.exit(1);
});
