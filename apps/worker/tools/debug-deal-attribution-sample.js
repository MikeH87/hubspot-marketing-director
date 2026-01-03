require("dotenv").config();

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) throw new Error("Missing HUBSPOT_PRIVATE_APP_TOKEN");

async function hsFetch(path, opts = {}) {
  const url = `https://api.hubapi.com${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`HubSpot ${opts.method || "GET"} ${path} failed: ${res.status} ${text}`);
  return json;
}

(async () => {
  // Pull 25 recent deals and inspect associated contacts + key fields.
  const dealProps = ["dealname","dealtype","amount","pipeline","dealstage","closedate","hs_is_closed_won","createdate"];
  const resp = await hsFetch("/crm/v3/objects/deals?limit=25&properties=" + encodeURIComponent(dealProps.join(",")));
  const deals = resp.results || [];

  const out = [];
  for (const d of deals) {
    const assoc = await hsFetch(`/crm/v3/objects/deals/${d.id}/associations/contacts?limit=10`);
    const contactId = (assoc.results && assoc.results[0] && assoc.results[0].id) ? assoc.results[0].id : null;

    let contact = null;
    if (contactId) {
      // Pull a broader set of fields that might help attribution
      const cProps = [
        "hs_analytics_last_touch_converting_campaign",
        "hs_analytics_first_touch_converting_campaign",
        "hs_analytics_source",
        "hs_analytics_source_data_1",
        "hs_analytics_source_data_2",
        "utm_campaign",
        "utm_source",
        "utm_medium",
        "hs_manual_campaign_ids",
        "engagements_last_meeting_booked_campaign",
        "engagements_last_meeting_booked_source"
      ];
      contact = await hsFetch(`/crm/v3/objects/contacts/${contactId}?properties=` + encodeURIComponent(cProps.join(",")));
    }

    out.push({
      deal: { id: d.id, ...d.properties },
      primaryContactId: contactId,
      contactProps: contact ? (contact.properties || {}) : null
    });
  }

  const fs = require("fs");
  const path = require("path");
  const file = path.join(process.cwd(), "debug-deal-attribution-sample.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote:", file);
  console.log("Sampled deals:", out.length);
})();
