/**
 * Step 2D Audit:
 * - Determine whether conversionId can be resolved to a contact identifier (vid/contactId)
 * - Read-only; no DB writes
 */

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN");
  console.log("STEP2D_FAILED");
  process.exit(1);
}

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}` };
const DAYS = 30; // smaller window for faster sampling
const since = Date.now() - DAYS * 24 * 60 * 60 * 1000;

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function safeJsonParse(t) {
  try { return JSON.parse(t); } catch { return null; }
}

async function run() {
  const formsRes = await fetch("https://api.hubapi.com/forms/v2/forms", { headers: HEADERS });
  if (!formsRes.ok) throw new Error(`${formsRes.status} ${await formsRes.text()}`);
  const forms = await formsRes.json();

  const conversionIds = [];
  for (const form of forms) {
    const name = (form.name || "").toLowerCase();
    if (name.includes("practitioner")) continue;

    const url = `https://api.hubapi.com/form-integrations/v1/submissions/forms/${form.guid}?since=${since}`;
    const res = await fetch("https://api.hubapi.com/form-integrations/v1/submissions/forms/" + form.guid + "?since=" + since, { headers: HEADERS });
    if (!res.ok) continue;
    const body = await res.json();
    for (const s of (body.results || [])) {
      if (s.conversionId) conversionIds.push(s.conversionId);
      if (conversionIds.length >= 25) break;
    }
    if (conversionIds.length >= 25) break;
  }

  console.log("\n=== STEP 2D: conversionId resolution audit ===\n");
  console.log(`Sample conversionIds collected: ${conversionIds.length}`);

  if (conversionIds.length === 0) {
    console.log("No conversionIds found to test.");
    console.log("\nSTEP2D_FAILED");
    process.exit(1);
  }

  // Candidate endpoints to try. HubSpot has a few variations across accounts/legacy APIs.
  const candidates = (id) => ([
    `https://api.hubapi.com/form-integrations/v1/submissions/${id}`,
    `https://api.hubapi.com/form-integrations/v1/submissions/${id}/details`,
    `https://api.hubapi.com/form-integrations/v1/submissions/${id}?include=contact`,
  ]);

  let resolved = 0;
  let firstSuccessKeys = null;

  for (const id of conversionIds) {
    let found = false;

    for (const url of candidates(id)) {
      const r = await fetchText(url);
      if (!r.ok) continue;

      const j = safeJsonParse(r.text);
      if (!j || typeof j !== "object") continue;

      const keys = Object.keys(j).sort();
      const vid = j.vid ?? j.contactId ?? j.contactID ?? j.contact_id;

      if (!firstSuccessKeys) firstSuccessKeys = keys;

      if (vid) {
        resolved++;
        found = true;
        break;
      }
    }

    // Small delay to be kind to rate limits
    await new Promise(r => setTimeout(r, 120));
  }

  console.log(`Resolved to a contact identifier: ${resolved}/${conversionIds.length}`);

  if (firstSuccessKeys) {
    console.log("\nSample keys from first successful detail response:");
    console.log(firstSuccessKeys.join(", "));
  } else {
    console.log("\nNo successful detail responses found (all endpoints failed or returned non-JSON).");
  }

  if (resolved > 0) console.log("\nSTEP2D_OK");
  else console.log("\nSTEP2D_NO_MAPPING");
}

run().catch(err => {
  console.error(err);
  console.log("\nSTEP2D_FAILED");
  process.exit(1);
});
