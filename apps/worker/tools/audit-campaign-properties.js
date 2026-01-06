/**
 * Step 3D Audit: try requesting campaign properties explicitly
 * Read-only; no DB writes.
 */
const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) { console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN"); console.log("STEP3D_FAILED"); process.exit(1); }
const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}` };

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, text, json };
}

async function run() {
  console.log("\n=== STEP 3D: CAMPAIGN PROPERTIES REQUEST AUDIT ===\n");

  const urls = [
    "https://api.hubapi.com/marketing/v3/campaigns/?limit=5&properties=name",
    "https://api.hubapi.com/marketing/v3/campaigns/?limit=5&properties=campaignName",
    "https://api.hubapi.com/marketing/v3/campaigns/?limit=5&properties=hs_name",
    "https://api.hubapi.com/marketing/v3/campaigns/?limit=5&properties=hs_campaign_name"
  ];

  for (const u of urls) {
    const r = await fetchText(u);
    console.log(`\nURL: ${u}`);
    console.log(`HTTP ${r.status}`);
    if (r.ok && r.json?.results?.length) {
      const first = r.json.results[0];
      console.log("First result keys:", Object.keys(first).sort().join(", "));
      console.log("First result properties:", JSON.stringify(first.properties || {}).slice(0, 300));
    } else {
      console.log((r.text || "").slice(0, 200).replace(/\s+/g, " "));
    }
  }

  console.log("\nSTEP3D_OK");
}

run().catch(err => { console.error(err); console.log("\nSTEP3D_FAILED"); process.exit(1); });
