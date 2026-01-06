const { Client } = require("pg");

async function main() {
  const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;

  if (!HUBSPOT_TOKEN) { console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN"); console.log("STEP12A_FAILED"); process.exit(1); }
  if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)"); console.log("STEP12A_FAILED"); process.exit(1); }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  // Add columns safely (no data loss)
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_latest_source TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_latest_source_data_1 TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_latest_source_data_2 TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_analytics_source_data_1 TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS hs_analytics_source_data_2 TEXT NULL;`);
  await client.query(`ALTER TABLE contact_email_cache ADD COLUMN IF NOT EXISTS facebook_ad_name TEXT NULL;`);

  await client.end();
  console.log("STEP12A_DB_OK");
}

main().catch(e => { console.error(e); console.log("STEP12A_FAILED"); process.exit(1); });
