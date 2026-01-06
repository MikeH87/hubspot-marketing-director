/**
 * Migration: lead_contact_map
 * Stores Lead ↔ Contact associations for joining leads to form UTMs (via contact email).
 */
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL).");
    console.log("STEP11A_FAILED");
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS lead_contact_map (
      lead_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (lead_id, contact_id)
    );
  `);

  await client.end();
  console.log("STEP11A_OK");
}

main().catch(err => {
  console.error(err);
  console.log("STEP11A_FAILED");
  process.exit(1);
});
