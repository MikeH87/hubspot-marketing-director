/**
 * Migration: add lead_facts_raw table
 * Safe, additive, no impact on existing pipeline.
 */
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL).");
    console.log("STEP10B_FAILED");
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS lead_facts_raw (
      lead_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      lead_status TEXT NULL,
      lead_stage TEXT NULL,
      owner_id TEXT NULL,
      disqualification_reason TEXT NULL,
      created_at_ingested TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.end();
  console.log("STEP10B_OK");
}

main().catch(err => {
  console.error(err);
  console.log("STEP10B_FAILED");
  process.exit(1);
});
