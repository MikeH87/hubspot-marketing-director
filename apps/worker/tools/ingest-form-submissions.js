/**
 * Ingest HubSpot form submissions into Postgres.
 * - Source: form-integrations v1 submissions endpoint
 * - Extract UTMs + email from submission payload values
 * - Exclude forms whose name contains "Practitioner" (case-insensitive)
 * - Idempotent insert via unique index on (form_guid, submitted_at, email, utm_campaign, page_url)
 *
 * Usage:
 *   node tools/ingest-form-submissions.js            # default 7 days
 *   node tools/ingest-form-submissions.js --days 90  # backfill 90 days
 */

const { Client } = require("pg");

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const DAYS = argValue("--days", 7);
const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;

if (!HUBSPOT_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN");
  process.exit(1);
}
if (!connectionString) {
  console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)");
  process.exit(1);
}

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}` };

const UTM_FIELDS = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content"];

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(`${res.status} ${text}`);
  }
  return json;
}

function valuesToMap(values) {
  const m = {};
  for (const v of (values || [])) {
    const name = (v?.name || v?.fieldName || v?.key);
    const value = (v?.value ?? v?.values ?? v?.val);
    if (!name) continue;
    m[String(name).toLowerCase()] = value;
  }
  return m;
}

function normStr(x) {
  if (x === undefined || x === null) return null;
  const s = Array.isArray(x) ? x.join(",") : String(x);
  const t = s.trim();
  return t === "" ? null : t;
}

async function main() {
  const since = Date.now() - DAYS * 24 * 60 * 60 * 1000;

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const forms = await fetchJSON("https://api.hubapi.com/forms/v2/forms");

  let inserted = 0;
  let scanned = 0;
  let skippedPractitioner = 0;

  for (const form of forms) {
    const formGuid = form.guid;
    const formName = form.name || "(unnamed form)";
    if (formName.toLowerCase().includes("practitioner")) {
      skippedPractitioner++;
      continue;
    }

    const url = `https://api.hubapi.com/form-integrations/v1/submissions/forms/${formGuid}?since=${since}`;
    const submissions = await fetchJSON(url);
    const results = submissions.results || [];

    for (const s of results) {
      scanned++;
      const submittedAt = new Date(Number(s.submittedAt || 0));
      if (isNaN(submittedAt.getTime())) continue;

      const pageUrl = normStr(s.pageUrl);
      const valuesMap = valuesToMap(s.values);

      const email = normStr(valuesMap["email"]);
      const utm_source = normStr(valuesMap["utm_source"]);
      const utm_medium = normStr(valuesMap["utm_medium"]);
      const utm_campaign = normStr(valuesMap["utm_campaign"]);
      const utm_term = normStr(valuesMap["utm_term"]);
      const utm_content = normStr(valuesMap["utm_content"]);

      // Keep raw values for auditability (but do not store secrets)
      const rawValuesJson = valuesMap;

      const q = `
        INSERT INTO form_submissions_raw
          (submitted_at, form_guid, form_name, page_url, email,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content, raw_values_json)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING;
      `;

      const before = inserted;
      await client.query(q, [
        submittedAt.toISOString(),
        formGuid,
        formName,
        pageUrl,
        email,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        rawValuesJson
      ]);

      // We can't easily get rowcount on DO NOTHING without RETURNING; keep it simple:
      // we'll count inserts by querying the unique key existence isn't worth it here.
      // Instead, track scanned and rely on DB constraints + later verification queries.
    }
  }

  // Verification: count rows in table for last DAYS
  const verify = await client.query(
    `SELECT COUNT(*)::int AS c FROM form_submissions_raw WHERE submitted_at >= NOW() - ($1 || ' days')::interval`,
    [String(DAYS)]
  );

  await client.end();

  console.log("=== INGEST FORM SUBMISSIONS ===");
  console.log(`Days window: ${DAYS}`);
  console.log(`Forms excluded (Practitioner): ${skippedPractitioner}`);
  console.log(`Submissions scanned: ${scanned}`);
  console.log(`Rows in DB within window: ${verify.rows[0].c}`);
  console.log("STEP9A_OK");
}

main().catch(err => {
  console.error(err);
  console.log("STEP9A_FAILED");
  process.exit(1);
});
