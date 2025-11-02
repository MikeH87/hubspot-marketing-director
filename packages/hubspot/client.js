const BASE = "https://api.hubapi.com";

async function hsGet(path, qs = {}) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not set");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot GET ${url.pathname} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

async function getAllCampaigns(max = 500) {
  // fetch all pages
  async function page(limit = 100, after) {
    const url = "/marketing/v3/campaigns";
    const json = await hsGet(url, { limit, after });
    const results = Array.isArray(json.results) ? json.results : [];
    const next = json?.paging?.next?.after || null;
    return { results, next };
  }
  const out = [];
  let after;
  while (out.length < max) {
    const { results, next } = await page(100, after);
    out.push(...results);
    if (!next) break;
    after = next;
  }
  return out;
}

// Build a path from a template, e.g. "/marketing/v3/accounts/{ACCOUNT_ID}/campaigns/{CAMPAIGN_ID}/analytics"
async function hsGetFromTemplate(pathTemplate, vars) {
  if (!pathTemplate) throw new Error("No analytics path template provided");
  let path = pathTemplate;
  for (const [k, v] of Object.entries(vars || {})) {
    path = path.replaceAll(`{${k}}`, String(v));
  }
  if (!path.startsWith("/")) path = "/" + path;
  return hsGet(path, {});
}

module.exports = { hsGet, getAllCampaigns, hsGetFromTemplate };
