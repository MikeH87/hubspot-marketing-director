/**
 * Step 2B Audit:
 * - Discover attribution-related contact properties in THIS HubSpot portal
 * - Re-check attribution coverage for contacts tied to form submissions (last 90d)
 * - Read-only; no DB writes
 */

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN");
  console.log("STEP2B_FAILED");
  process.exit(1);
}

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };
const DAYS = 90;
const since = Date.now() - DAYS * 24 * 60 * 60 * 1000;

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { headers: HEADERS, ...opts });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  return res.json();
}

function isAttributionPropName(n) {
  const s = n.toLowerCase();
  return (
    s.includes("utm") ||
    s.includes("campaign") ||
    s.includes("source") ||
    s.includes("medium") ||
    s.includes("referrer") ||
    s.includes("analytics") ||
    s.includes("gclid") ||
    s.includes("fbclid") ||
    s.includes("msclkid") ||
    s.includes("ttclid") ||
    s.includes("first") ||
    s.includes("last") ||
    s.includes("latest")
  );
}

function hasAnyValue(props, keys) {
  for (const k of keys) {
    const v = props?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return true;
  }
  return false;
}

async function run() {
  // 1) Discover portal-specific contact properties
  const propResp = await fetchJSON("https://api.hubapi.com/crm/v3/properties/contacts");
  const allProps = (propResp.results || []).map(p => p.name);
  const candidates = allProps.filter(isAttributionPropName);

  // Keep URL/property payloads reasonable: cap to 60 candidate fields.
  const candidateProps = candidates.slice(0, 60);

  console.log("\n=== STEP 2B: DISCOVER ATTRIBUTION PROPS ===\n");
  console.log(`Total contact properties in portal: ${allProps.length}`);
  console.log(`Attribution-like properties found: ${candidates.length}`);
  console.log(`Using (capped) attribution properties for audit: ${candidateProps.length}\n`);

  // Show a sample list so we can sanity-check names
  console.log("Sample attribution-like property names:");
  candidateProps.slice(0, 25).forEach(p => console.log(`- ${p}`));

  // 2) Pull forms + submissions, collect a sample of contact IDs (vids)
  const forms = await fetchJSON("https://api.hubapi.com/forms/v2/forms");

  const vids = [];
  const seen = new Set();

  for (const form of forms) {
    const formName = (form.name || "").toLowerCase();
    if (formName.includes("practitioner")) continue;

    const submissions = await fetchJSON(
      `https://api.hubapi.com/form-integrations/v1/submissions/forms/${form.guid}?since=${since}`
    );

    for (const s of (submissions.results || [])) {
      const vid = s.vid;
      if (!vid) continue;
      if (!seen.has(vid)) {
        seen.add(vid);
        vids.push(String(vid));
      }
      if (vids.length >= 200) break; // sample size
    }
    if (vids.length >= 200) break;
  }

  console.log(`\nUnique contact IDs sampled from submissions: ${vids.length}`);

  if (vids.length === 0) {
    console.log("No contact IDs found on submissions; cannot audit contact attribution.");
    console.log("\nSTEP2B_FAILED");
    process.exit(1);
  }

  // 3) Batch read contacts for these vids with candidate properties
  // HubSpot batch read limit is typically 100 per request; do it in chunks.
  const chunkSize = 100;
  let checked = 0;
  let withAttrib = 0;

  const propHitCounts = {}; // propName -> count of non-empty occurrences

  for (let i = 0; i < vids.length; i += chunkSize) {
    const batch = vids.slice(i, i + chunkSize).map(id => ({ id }));
    const body = JSON.stringify({ inputs: batch, properties: candidateProps });

    const resp = await fetchJSON(
      "https://api.hubapi.com/crm/v3/objects/contacts/batch/read",
      { method: "POST", body }
    );

    for (const r of (resp.results || [])) {
      checked++;
      const props = r.properties || {};
      const hasAttrib = hasAnyValue(props, candidateProps);
      if (hasAttrib) withAttrib++;

      for (const k of candidateProps) {
        const v = props[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          propHitCounts[k] = (propHitCounts[k] || 0) + 1;
        }
      }
    }
  }

  const coverage = checked ? ((withAttrib / checked) * 100) : 0;

  console.log("\n=== STEP 2B RESULTS ===\n");
  console.log(`Contacts checked: ${checked}`);
  console.log(`Contacts with ANY attribution evidence (in discovered props): ${withAttrib}`);
  console.log(`Coverage: ${coverage.toFixed(1)}%`);

  const topProps = Object.entries(propHitCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log("\nTop populated attribution properties (non-empty counts):");
  topProps.forEach(([k, c]) => console.log(`${k}: ${c}`));

  console.log("\nSTEP2B_OK");
}

run().catch(err => {
  console.error(err);
  console.log("\nSTEP2B_FAILED");
  process.exit(1);
});
