/**
 * Step 3B Audit: Campaign Spend Items coverage & granularity
 * - Lists campaigns (first N)
 * - For each campaign, tries to fetch spend items
 * - Reports: item count + date spread (min/max)
 * Read-only; no DB writes.
 */

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN");
  console.log("STEP3B_FAILED");
  process.exit(1);
}
const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, text, json };
}

function toISODate(ms) {
  if (!ms) return null;
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0,10);
}

async function run() {
  console.log("\n=== STEP 3B: CAMPAIGN SPEND ITEMS AUDIT ===\n");

  // 1) List campaigns (first 25)
  // Common endpoint pattern for campaigns API
  const list = await fetchJSON("https://api.hubapi.com/marketing/v3/campaigns/?limit=25");
  if (!list.ok) {
    console.log("Campaign list failed:");
    console.log(`HTTP ${list.status}`);
    console.log(list.text.slice(0, 500));
    console.log("\nSTEP3B_FAILED");
    process.exit(1);
  }

  const campaigns = list.json?.results || [];
  console.log(`Campaigns fetched: ${campaigns.length}\n`);

  // Print a few campaign ids/names so we can sanity-check
  campaigns.slice(0, 10).forEach(c => {
    console.log(`- ${c.id}: ${c.name}`);
  });

  let spendItemsSupported = 0;

  // 2) For each campaign, attempt spend items endpoints (multiple patterns)
  const spendEndpointsFor = (id) => ([
    `https://api.hubapi.com/marketing/v3/campaigns/${id}/spend`,          // possible list
    `https://api.hubapi.com/marketing/v3/campaigns/${id}/spend/items`,    // possible list
    `https://api.hubapi.com/marketing/v3/campaigns/${id}/spend-items`,    // possible list
  ]);

  console.log("\n--- Spend items checks (first 10 campaigns) ---\n");

  for (const c of campaigns.slice(0, 10)) {
    let ok = false;
    let items = null;
    let usedUrl = null;

    for (const url of spendEndpointsFor(c.id)) {
      const r = await fetchJSON(url);
      if (r.ok && r.json) {
        ok = true;
        usedUrl = url;
        // Try common shapes
        items = r.json.results || r.json.items || r.json || null;
        break;
      }
    }

    if (!ok) {
      console.log(`${c.id} | ${c.name} | spend items: NOT FOUND (all endpoints failed)`);
      continue;
    }

    spendItemsSupported++;

    // Normalise to array
    const arr = Array.isArray(items) ? items : (items?.results || []);
    const count = Array.isArray(arr) ? arr.length : 0;

    // Look for date fields
    let dates = [];
    for (const it of (arr || [])) {
      const d = it.date || it.spendDate || it.timestamp || it.createdAt || it.createdate || it.createdAtMs;
      const iso = toISODate(d);
      if (iso) dates.push(iso);
    }
    dates.sort();

    const min = dates[0] || "n/a";
    const max = dates[dates.length - 1] || "n/a";

    console.log(`${c.id} | ${c.name} | items=${count} | dateSpread=${min}→${max} | via=${usedUrl}`);
  }

  console.log(`\nSpend items supported for ${spendItemsSupported}/10 tested campaigns`);
  console.log("\nIf spend items exist but items≈1 for FB/Google/LinkedIn, HubSpot is only storing rolled-up totals.");
  console.log("\nSTEP3B_OK");
}

run().catch(err => {
  console.error(err);
  console.log("\nSTEP3B_FAILED");
  process.exit(1);
});
