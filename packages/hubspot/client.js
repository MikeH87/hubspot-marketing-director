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

// CRM sample (already used)
async function testDealsSample(limit = 3) {
  const json = await hsGet("/crm/v3/objects/deals", { limit });
  return {
    count: (json && Array.isArray(json.results)) ? json.results.length : 0,
    sampleIds: (json.results || []).map(r => r.id)
  };
}

/**
 * Marketing Emails (read-only smoke test)
 * Returns count of email records accessible to the token.
 * Note: endpoint shape may vary per portal; this is a safe listing.
 */
async function testMarketingEmails(limit = 3) {
  const json = await hsGet("/marketing/v3/marketing-emails", { limit });
  const items = Array.isArray(json.results) ? json.results : (Array.isArray(json.items) ? json.items : []);
  return { count: items.length };
}

/**
 * Ads Accounts (read-only smoke test)
 * Lists connected ad accounts; confirms ads.read scope works.
 */
async function testAdsAccounts(limit = 5) {
  const json = await hsGet("/marketing/v3/ads/accounts", { limit });
  const items = Array.isArray(json.results) ? json.results : (Array.isArray(json.accounts) ? json.accounts : []);
  return { count: items.length };
}

module.exports = { hsGet, testDealsSample, testMarketingEmails, testAdsAccounts };
