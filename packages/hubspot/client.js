const BASE = "https://api.hubapi.com";

async function hsGet(path, qs = {}) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not set");

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot GET ${url.pathname} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

// ---- Get Campaigns ----
async function getCampaigns(limit = 10) {
  const json = await hsGet("/marketing/v3/campaigns", { limit });
  return Array.isArray(json.results) ? json.results : [];
}

module.exports = { getCampaigns };
