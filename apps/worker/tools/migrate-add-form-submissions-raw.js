/**
 * Migration: add form_submissions_raw table (additive, safe).
 * Uses the SAME DATABASE_URL approach as existing scripts (assumes env is set on Render; locally you may need it).
 */
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL).");
    console.log("STEP8_FAILED");
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS form_submissions_raw (
      id BIGSERIAL PRIMARY KEY,
      submitted_at TIMESTAMPTZ NOT NULL,
      form_guid TEXT NOT NULL,
      form_name TEXT NOT NULL,
      page_url TEXT NULL,
      email TEXT NULL,
      utm_source TEXT NULL,
      utm_medium TEXT NULL,
      utm_campaign TEXT NULL,
      utm_term TEXT NULL,
      utm_content TEXT NULL,
      raw_values_json JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_form_submissions_raw_unique
    ON form_submissions_raw (form_guid, submitted_at, COALESCE(email, ''), COALESCE(utm_campaign, ''), COALESCE(page_url, ''));
  `);

  await client.end();
  console.log("STEP8_OK");
}

main().catch(err => {
  console.error(err);
  console.log("STEP8_FAILED");
  process.exit(1);
});
