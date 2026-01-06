require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} (or set in .env.local)`);
  return v;
}

function makePool() {
  const cs = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!cs) throw new Error("Missing DATABASE_URL (or RENDER_DATABASE_URL).");

  // Render Postgres typically requires SSL. This keeps it resilient across environments.
  return new Pool({
    connectionString: cs,
    ssl: cs.includes("localhost") || cs.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
  });
}

const STAGE_LABELS = {
  "new-stage-id": "New",
  "attempting-stage-id": "Attempting",
  "connected-stage-id": "Connected",
  "1213103916": "Sales Qualified",
  "qualified-stage-id": "Zoom Booked",
  "unqualified-stage-id": "Disqualified",
  "1109558437": "Not Applicable (additional Director/Member)",
  "1134678094": "Marketing Prospect",
};

async function main() {
  const pool = makePool();

  const windowDays = 90;

  const totalRes = await pool.query(
    `select count(*)::int as n
     from lead_facts_raw
     where created_at >= now() - ($1::int * interval '1 day')`,
    [windowDays]
  );

  const byStageRes = await pool.query(
    `select coalesce(lead_stage,'(null)') as lead_stage, count(*)::int as n
     from lead_facts_raw
     where created_at >= now() - ($1::int * interval '1 day')
     group by 1
     order by n desc`,
    [windowDays]
  );

  const total = totalRes.rows[0]?.n ?? 0;

  console.log("=== LEAD STAGE AUDIT (DB: lead_facts_raw.lead_stage) ===");
  console.log(`Window: last ${windowDays} days`);
  console.log(`Total leads created: ${total}`);
  console.log("");

  for (const r of byStageRes.rows) {
    const id = r.lead_stage;
    const label = STAGE_LABELS[id] || "(unknown stage id)";
    console.log(`- ${label} | stageId=${id} | count=${r.n}`);
  }

  // Quick sanity slices we care about for reporting exclusions
  const notApplicable = byStageRes.rows.find(r => r.lead_stage === "1109558437")?.n || 0;
  const marketingProspect = byStageRes.rows.find(r => r.lead_stage === "1134678094")?.n || 0;
  const disqualified = byStageRes.rows.find(r => r.lead_stage === "unqualified-stage-id")?.n || 0;

  console.log("");
  console.log("=== SANITY COUNTS ===");
  console.log(`Not Applicable (exclude): ${notApplicable}`);
  console.log(`Marketing Prospect: ${marketingProspect}`);
  console.log(`Disqualified: ${disqualified}`);
  console.log("STEP16B_OK");

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  console.log("STEP16B_FAILED");
  process.exit(1);
});
