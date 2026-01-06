/**
 * Step 2E Audit:
 * - Confirm email is present in submission payload values
 * - Measure coverage: email only, email+UTM
 * - Read-only; no DB writes
 */

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN");
  console.log("STEP2E_FAILED");
  process.exit(1);
}

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}` };
const DAYS = 90;
const since = Date.now() - DAYS * 24 * 60 * 60 * 1000;

const UTM_FIELDS = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content"];

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function getValuesMap(values) {
  const m = {};
  for (const v of (values || [])) {
    const name = v?.name || v?.fieldName || v?.key;
    const value = v?.value ?? v?.values ?? v?.val;
    if (!name) continue;
    m[String(name).toLowerCase()] = value;
  }
  return m;
}

function hasAnyUtm(m) {
  return UTM_FIELDS.some(f => {
    const v = m[f];
    if (v === undefined || v === null) return false;
    const s = Array.isArray(v) ? v.join(",") : String(v);
    return s.trim() !== "";
  });
}

async function run() {
  const forms = await fetchJSON("https://api.hubapi.com/forms/v2/forms");

  let total = 0;
  let withEmail = 0;
  let withEmailAndUtm = 0;

  let sampleKeysPrinted = false;
  let sampleEmailKey = null;

  for (const form of forms) {
    const name = (form.name || "").toLowerCase();
    if (name.includes("practitioner")) continue;

    const submissions = await fetchJSON(
      `https://api.hubapi.com/form-integrations/v1/submissions/forms/${form.guid}?since=${since}`
    );

    for (const s of (submissions.results || [])) {
      total++;
      const m = getValuesMap(s.values);

      if (!sampleKeysPrinted) {
        sampleKeysPrinted = true;
        const keys = Object.keys(m).sort();
        console.log("\n=== SAMPLE SUBMISSION VALUE KEYS (lowercased) ===");
        console.log(keys.slice(0, 40).join(", "));
        console.log("=== END SAMPLE KEYS ===\n");
        sampleEmailKey = keys.find(k => k.includes("email"));
      }

      const emailVal = m["email"] ?? m["email address"] ?? m["e-mail"] ?? null;
      const hasEmail = emailVal && String(emailVal).trim() !== "";
      if (hasEmail) withEmail++;

      const hasUtm = hasAnyUtm(m);
      if (hasEmail && hasUtm) withEmailAndUtm++;
    }
  }

  console.log("\n=== STEP 2E: EMAIL JOIN FEASIBILITY (LAST 90 DAYS) ===\n");
  console.log(`Total submissions analysed: ${total}`);
  console.log(`Submissions with email present: ${withEmail} (${total ? ((withEmail/total)*100).toFixed(1) : 0}%)`);
  console.log(`Submissions with email + any UTM: ${withEmailAndUtm} (${total ? ((withEmailAndUtm/total)*100).toFixed(1) : 0}%)`);
  console.log(`Detected email-like key example: ${sampleEmailKey || "NOT_DETECTED"}`);

  console.log("\nSTEP2E_OK");
}

run().catch(err => {
  console.error(err);
  console.log("\nSTEP2E_FAILED");
  process.exit(1);
});
