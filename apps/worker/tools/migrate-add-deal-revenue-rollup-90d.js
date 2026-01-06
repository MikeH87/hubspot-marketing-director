const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL).");
    console.log("STEP13A_FAILED");
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS deal_revenue_rollup_90d (
      utm_campaign TEXT NOT NULL,
      utm_source TEXT NOT NULL DEFAULT '',
      utm_medium TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL DEFAULT '',
      dealtype TEXT NOT NULL DEFAULT '',
      deals_won INT NOT NULL,
      revenue_won NUMERIC NOT NULL,
      avg_days_lead_to_close NUMERIC NULL,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (utm_campaign, utm_source, utm_medium, owner_id, dealtype)
    );
  `);

  await client.end();
  console.log("STEP13A_OK");
}

main().catch(e => {
  console.error(e);
  console.log("STEP13A_FAILED");
  process.exit(1);
});
