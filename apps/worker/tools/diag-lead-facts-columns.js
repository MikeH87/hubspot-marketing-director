const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)."); console.log("STEP12C1_FAILED"); process.exit(1); }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const cols = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lead_facts_raw'
    ORDER BY ordinal_position;
  `);

  const names = cols.rows.map(r => r.column_name);
  const matches = names.filter(n =>
    n.toLowerCase().includes("disqual") ||
    n.toLowerCase().includes("loss") ||
    n.toLowerCase().includes("reason") ||
    n.toLowerCase().includes("lead_status") ||
    n.toLowerCase().includes("status")
  );

  console.log("=== lead_facts_raw columns (filtered) ===");
  for (const n of matches) console.log("- " + n);

  console.log("=== lead_facts_raw columns (first 40) ===");
  for (const n of names.slice(0, 40)) console.log("- " + n);

  await client.end();
  console.log("STEP12C1_OK");
}

main().catch(e => { console.error(e); console.log("STEP12C1_FAILED"); process.exit(1); });
