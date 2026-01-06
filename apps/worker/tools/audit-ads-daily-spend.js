/**
 * Step 3 Audit: HubSpot Ads API daily spend availability (last 30 days)
 * Read-only. No DB writes.
 *
 * Notes:
 * - HubSpot Ads APIs vary by account + permissions.
 * - This script tries a small set of likely endpoints and reports what works.
 */

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN");
  console.log("STEP3_FAILED");
  process.exit(1);
}
const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { headers: HEADERS, ...opts });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, text, json };
}

function iso(d) { return new Date(d).toISOString().slice(0,10); }
const end = new Date();
const start = new Date(Date.now() - 30*24*60*60*1000);

const candidates = [
  // Commonly-used ads reporting endpoints in HubSpot portals (varies by plan).
  { name: "Ads reporting (attempt 1)", url: `https://api.hubapi.com/ads/v1/reports/performance?start=${iso(start)}&end=${iso(end)}&timeGranularity=DAY` },
  { name: "Ads reporting (attempt 2)", url: `https://api.hubapi.com/ads/v1/reports?start=${iso(start)}&end=${iso(end)}&timeGranularity=DAY` },
  { name: "Ads accounts list",          url: `https://api.hubapi.com/ads/v1/accounts` },
  { name: "Ads campaigns list",         url: `https://api.hubapi.com/ads/v1/campaigns?limit=10` },
];

async function run() {
  console.log("\n=== STEP 3: HUBSPOT ADS API DAILY SPEND AUDIT ===\n");
  console.log(`Date window: ${iso(start)} → ${iso(end)}\n`);

  const results = [];
  for (const c of candidates) {
    const r = await fetchJSON(c.url);
    results.push({ name: c.name, url: c.url, status: r.status, ok: r.ok, json: r.json });
    console.log(`${c.name}: ${r.ok ? "OK" : "FAIL"} (HTTP ${r.status})`);
  }

  // Heuristic: find any response that looks like it contains rows with dates + spend.
  let foundDaily = false;
  for (const r of results) {
    if (!r.ok || !r.json) continue;

    const str = JSON.stringify(r.json).toLowerCase();
    const hasDate = str.includes("date") || str.includes("day");
    const hasSpend = str.includes("spend") || str.includes("cost");

    if (hasDate && hasSpend) {
      foundDaily = true;
      console.log(`\nLikely daily spend payload found via: ${r.name}`);
      // Print small sample (trimmed)
      const sample = JSON.stringify(r.json).slice(0, 1200);
      console.log("\n--- SAMPLE PAYLOAD (trimmed) ---");
      console.log(sample);
      console.log("--- END SAMPLE ---\n");
      break;
    }
  }

  console.log(foundDaily ? "DAILY_SPEND_DETECTED" : "DAILY_SPEND_NOT_DETECTED");
  console.log("\nSTEP3_OK");
}

run().catch(err => {
  console.error(err);
  console.log("\nSTEP3_FAILED");
  process.exit(1);
});
