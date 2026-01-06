const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)."); console.log("STEP13B0_FAILED"); process.exit(1); }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  await client.query(`
    ALTER TABLE campaign_context_snapshot_90d
      ADD COLUMN IF NOT EXISTS pipeline_created_90d_sales numeric,
      ADD COLUMN IF NOT EXISTS revenue_won_90d_sales numeric;
  `);

  console.log("STEP13B0_OK");
  await client.end();
}

main().catch(e => { console.error(e); console.log("STEP13B0_FAILED"); process.exit(1); });
