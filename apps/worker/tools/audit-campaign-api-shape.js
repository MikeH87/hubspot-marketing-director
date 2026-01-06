/**
 * Step 3C Audit:
 * - Inspect campaign API payload shape (where is the name?)
 * - Probe spend endpoints and print HTTP status + snippet
 * Read-only; no DB writes.
 */

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN");
  console.log("STEP3C_FAILED");
  process.exit(1);
}
const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, text, json };
}

function keysOf(x) {
  if (!x || typeof x !== "object") return [];
  return Object.keys(x).sort();
}

async function run() {
  console.log("\n=== STEP 3C: CAMPAIGN API SHAPE + SPEND ENDPOINT PROBES ===\n");

  const listUrl = "https://api.hubapi.com/marketing/v3/campaigns/?limit=5";
  const list = await fetchText(listUrl);
  console.log(`Campaign list: HTTP ${list.status}`);
  if (!list.ok) {
    console.log(list.text.slice(0, 400));
    console.log("\nSTEP3C_FAILED");
    process.exit(1);
  }

  const results = list.json?.results || [];
  console.log(`Campaigns returned: ${results.length}`);

  if (results.length === 0) {
    console.log("No campaigns returned.");
    console.log("\nSTEP3C_FAILED");
    process.exit(1);
  }

  const first = results[0];
  console.log("\n--- First campaign object keys ---");
  console.log(keysOf(first).join(", "));
  console.log("\n--- First campaign object (trimmed) ---");
  console.log(JSON.stringify(first).slice(0, 800));

  const id = first.id;
  console.log(`\nUsing campaign id for detail probe: ${id}`);

  // Campaign detail
  const detailUrl = `https://api.hubapi.com/marketing/v3/campaigns/${id}`;
  const detail = await fetchText(detailUrl);
  console.log(`\nCampaign detail: HTTP ${detail.status}`);
  if (detail.ok && detail.json) {
    console.log("--- Campaign detail keys ---");
    console.log(keysOf(detail.json).join(", "));
    console.log("--- Campaign detail (trimmed) ---");
    console.log(JSON.stringify(detail.json).slice(0, 900));
  } else {
    console.log(detail.text.slice(0, 300));
  }

  // Spend probes (GET only; read-only)
  const spendUrls = [
    `https://api.hubapi.com/marketing/v3/campaigns/${id}/spend`,
    `https://api.hubapi.com/marketing/v3/campaigns/${id}/spend/items`,
    `https://api.hubapi.com/marketing/v3/campaigns/${id}/spend-items`,
    `https://api.hubapi.com/marketing/v3/campaigns/${id}/spendItem`,
    `https://api.hubapi.com/marketing/v3/campaigns/${id}/spendItem/list`,
    `https://api.hubapi.com/marketing/v3/campaigns/${id}/spend-item`,
  ];

  console.log("\n--- Spend endpoint probes (GET) ---");
  for (const u of spendUrls) {
    const r = await fetchText(u);
    const snippet = (r.text || "").replace(/\s+/g, " ").slice(0, 200);
    console.log(`${r.status} | ${u} | ${snippet}`);
  }

  console.log("\nSTEP3C_OK");
}

run().catch(err => {
  console.error(err);
  console.log("\nSTEP3C_FAILED");
  process.exit(1);
});
