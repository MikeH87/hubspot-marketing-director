/**
 * Step 12B: Cache contact emails + attribution props for contacts linked to leads (90d)
 */
const { Client } = require("pg");

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;

if (!HUBSPOT_TOKEN) { console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN"); console.log("STEP12B_FAILED"); process.exit(1); }
if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)"); console.log("STEP12B_FAILED"); process.exit(1); }

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };

async function postJSON(url, body) {
  const res = await fetch(url, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return json;
}

async function main() {
  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  // Ensure base table exists (from Step 11C)
  await client.query(`
    CREATE TABLE IF NOT EXISTS contact_email_cache (
      contact_id TEXT PRIMARY KEY,
      email TEXT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Add columns if missing (safe)
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS utm_source TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS utm_medium TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS utm_campaign TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_latest_source TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_latest_source_data_1 TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_latest_source_data_2 TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_analytics_source_data_1 TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_analytics_source_data_2 TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS facebook_ad_name TEXT NULL;`);

  // Pull distinct contact IDs from lead_contact_map
  const q = await client.query("SELECT DISTINCT contact_id FROM lead_contact_map");
  const contactIds = q.rows.map(r => String(r.contact_id));

  let fetched = 0;
  const BATCH = 100;

  for (let i = 0; i < contactIds.length; i += BATCH) {
    const chunk = contactIds.slice(i, i + BATCH);

    const body = {
      properties: [
        "email",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "hs_latest_source",
        "hs_latest_source_data_1",
        "hs_latest_source_data_2",
        "hs_analytics_source_data_1",
        "hs_analytics_source_data_2",
        "facebook_ad_name"
      ],
      inputs: chunk.map(id => ({ id }))
    };

    const j = await postJSON("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", body);

    for (const r of (j.results || [])) {
      const contact_id = String(r.id);
      const p = r.properties || {};

      await client.query(
        `
        INSERT INTO contact_email_cache (
          contact_id, email,
          utm_source, utm_medium, utm_campaign,
          hs_latest_source, hs_latest_source_data_1, hs_latest_source_data_2,
          hs_analytics_source_data_1, hs_analytics_source_data_2,
          facebook_ad_name,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (contact_id) DO UPDATE SET
          email = EXCLUDED.email,
          utm_source = EXCLUDED.utm_source,
          utm_medium = EXCLUDED.utm_medium,
          utm_campaign = EXCLUDED.utm_campaign,
          hs_latest_source = EXCLUDED.hs_latest_source,
          hs_latest_source_data_1 = EXCLUDED.hs_latest_source_data_1,
          hs_latest_source_data_2 = EXCLUDED.hs_latest_source_data_2,
          hs_analytics_source_data_1 = EXCLUDED.hs_analytics_source_data_1,
          hs_analytics_source_data_2 = EXCLUDED.hs_analytics_source_data_2,
          facebook_ad_name = EXCLUDED.facebook_ad_name,
          updated_at = NOW();
        `,
        [
          contact_id,
          p.email || null,
          p.utm_source || null,
          p.utm_medium || null,
          p.utm_campaign || null,
          p.hs_latest_source || null,
          p.hs_latest_source_data_1 || null,
          p.hs_latest_source_data_2 || null,
          p.hs_analytics_source_data_1 || null,
          p.hs_analytics_source_data_2 || null,
          p.facebook_ad_name || null
        ]
      );

      fetched++;
    }

    if ((i / BATCH) % 20 === 0) {
      console.log(`Progress: ${Math.min(i + BATCH, contactIds.length)}/${contactIds.length} contacts processed`);
    }
  }

  const verify = await client.query(`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN utm_campaign IS NOT NULL AND utm_campaign <> '' THEN 1 ELSE 0 END)::int AS with_utm_campaign,
      SUM(CASE WHEN facebook_ad_name IS NOT NULL AND facebook_ad_name <> '' THEN 1 ELSE 0 END)::int AS with_fb_ad_name
    FROM contact_email_cache
  `);

  await client.end();

  console.log("=== CONTACT CACHE UPDATED ===");
  console.log(`Contacts processed: ${contactIds.length}`);
  console.log(`Rows updated: ${fetched}`);
  console.log(`Rows in cache: ${verify.rows[0].total}`);
  console.log(`With utm_campaign: ${verify.rows[0].with_utm_campaign}`);
  console.log(`With facebook_ad_name: ${verify.rows[0].with_fb_ad_name}`);
  console.log("STEP12B_OK");
}

main().catch(err => {
  console.error(err);
  console.log("STEP12B_FAILED");
  process.exit(1);
});
