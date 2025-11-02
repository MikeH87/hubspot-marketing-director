const BASE = "https://api.hubapi.com";

async function hsGet(path, qs = {}) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not set");

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot GET ${url.pathname} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

// Simple smoke test: pull a few deals (read scope check)
async function testDealsSample(limit = 3) {
  // Using CRM v3 objects API; no risky writes.
  const json = await hsGet("/crm/v3/objects/deals", { limit });
  return {
    count: (json && Array.isArray(json.results)) ? json.results.length : 0,
    sampleIds: (json.results || []).map(r => r.id)
  };
}

module.exports = { hsGet, testDealsSample };
