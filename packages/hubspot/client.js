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
      "Authorization": "Bearer " + token,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("HubSpot GET " + url.pathname + " failed: " + res.status + " " + res.statusText + " " + text);
  }
  return res.json();
}

async function hsPost(path, body = {}, qs = {}) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not set");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("HubSpot POST " + url.pathname + " failed: " + res.status + " " + res.statusText + " " + text);
  }
  return res.json();
}

// already used elsewhere
async function getAllCampaigns(max = 500) {
  async function page(limit = 100, after) {
    const json = await hsGet("/marketing/v3/campaigns", { limit, after });
    const results = Array.isArray(json.results) ? json.results : [];
    const next = (json && json.paging && json.paging.next && json.paging.next.after) ? json.paging.next.after : null;
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

// NEW: fetch the CRM object for a campaign (properties vary per portal)
async function getCampaignObject(campaignId) {
  // If CRM object exists for campaigns in your portal:
  // /crm/v3/objects/campaigns/{campaignId}
  // If that 404s, we fall back to the marketing/v3 listing detail:
  try {
    return await hsGet("/crm/v3/objects/campaigns/" + campaignId);
  } catch (e) {
    // fallback to marketing v3 item (it returns basic fields)
    const list = await hsGet("/marketing/v3/campaigns", { limit: 1, id: campaignId });
    return list;
  }
}

module.exports = { hsGet, hsPost, getAllCampaigns, getCampaignObject };
