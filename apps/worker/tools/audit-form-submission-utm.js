/**
 * Step 2C Audit:
 * - Read UTMs directly from form submission payload values (not contact props)
 * - Read-only: no DB writes
 * - Excludes forms with name containing "Practitioner"
 */

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN");
  console.log("STEP2C_FAILED");
  process.exit(1);
}

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}` };
const DAYS = 90;
const since = Date.now() - DAYS * 24 * 60 * 60 * 1000;

const UTM_FIELDS = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content"];

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  return res.json();
}

function getValuesMap(values) {
  const m = {};
  for (const v of (values || [])) {
    if (!v) continue;
    const name = v.name || v.fieldName || v.key;
    const value = v.value ?? v.values ?? v.val;
    if (!name) continue;
    m[String(name)] = value;
  }
  return m;
}

function hasAnyUtm(valuesMap) {
  return UTM_FIELDS.some(f => {
    const v = valuesMap[f];
    if (v === undefined || v === null) return false;
    const s = Array.isArray(v) ? v.join(",") : String(v);
    return s.trim() !== "";
  });
}

async function run() {
  const forms = await fetchJSON("https://api.hubapi.com/forms/v2/forms");

  let total = 0;
  let withAnyUtm = 0;
  let withAll3Core = 0; // source/medium/campaign
  let sampledShape = false;

  const perForm = {}; // formName -> {count, anyUtm, all3}

  for (const form of forms) {
    const name = form.name || "(unnamed form)";
    if (name.toLowerCase().includes("practitioner")) continue;

    const url = `https://api.hubapi.com/form-integrations/v1/submissions/forms/${form.guid}?since=${since}`;
    const submissions = await fetchJSON(url);

    const results = submissions.results || [];
    for (const s of results) {
      total++;
      perForm[name] ??= { count: 0, anyUtm: 0, all3: 0 };
      perForm[name].count++;

      if (!sampledShape) {
        sampledShape = true;
        const keys = Object.keys(s).sort();
        console.log("\n=== SAMPLE SUBMISSION OBJECT KEYS ===");
        console.log(keys.join(", "));
        console.log("=== END SAMPLE KEYS ===\n");
      }

      const valuesMap = getValuesMap(s.values);

      const anyUtm = hasAnyUtm(valuesMap);
      const core3 =
        (valuesMap.utm_source && String(valuesMap.utm_source).trim() !== "") &&
        (valuesMap.utm_medium && String(valuesMap.utm_medium).trim() !== "") &&
        (valuesMap.utm_campaign && String(valuesMap.utm_campaign).trim() !== "");

      if (anyUtm) {
        withAnyUtm++;
        perForm[name].anyUtm++;
      }
      if (core3) {
        withAll3Core++;
        perForm[name].all3++;
      }
    }
  }

  console.log("\n=== FORM SUBMISSION UTM AUDIT (LAST 90 DAYS) ===\n");
  console.log(`Total submissions analysed: ${total}`);
  console.log(`Submissions with ANY UTM field populated: ${withAnyUtm}`);
  console.log(`Coverage (any UTM): ${total ? ((withAnyUtm/total)*100).toFixed(1) : 0}%`);
  console.log(`Submissions with core 3 (source+medium+campaign): ${withAll3Core}`);
  console.log(`Coverage (core 3): ${total ? ((withAll3Core/total)*100).toFixed(1) : 0}%\n`);

  Object.entries(perForm)
    .sort((a,b) => b[1].count - a[1].count)
    .slice(0, 40)
    .forEach(([fname, s]) => {
      const pctAny = s.count ? ((s.anyUtm/s.count)*100).toFixed(1) : "0.0";
      const pct3 = s.count ? ((s.all3/s.count)*100).toFixed(1) : "0.0";
      console.log(`${fname} → ${s.count} subs | anyUTM ${s.anyUtm} (${pctAny}%) | core3 ${s.all3} (${pct3}%)`);
    });

  console.log("\nSTEP2C_OK");
}

run().catch(err => {
  console.error(err);
  console.log("\nSTEP2C_FAILED");
  process.exit(1);
});
