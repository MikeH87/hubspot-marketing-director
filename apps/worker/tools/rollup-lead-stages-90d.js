require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) throw new Error("Missing DATABASE_URL (or RENDER_DATABASE_URL).");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") || DATABASE_URL.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

const STAGES = {
  NEW: "new-stage-id",
  ATTEMPTING: "attempting-stage-id",
  CONNECTED: "connected-stage-id",
  SALES_QUALIFIED: "1213103916",
  ZOOM_BOOKED: "qualified-stage-id",
  DISQUALIFIED: "unqualified-stage-id",
  NOT_APPLICABLE: "1109558437",
  MARKETING_PROSPECT: "1134678094",
};

const CONSULTANTS = [
  "Jordan Sharpe",
  "Laura McCarthy",
  "Akash Bajaj",
  "Gareth Robertson",
  "David Gittings",
  "Spencer Dunn",
];

async function main() {
  const consultantStage = await pool.query(`
    SELECT
      o.full_name AS owner_name,
      COUNT(*)::int AS total,
      SUM(CASE WHEN l.lead_stage = $1 THEN 1 ELSE 0 END)::int AS zoom_booked,
      SUM(CASE WHEN l.lead_stage = $2 THEN 1 ELSE 0 END)::int AS sales_qualified,
      SUM(CASE WHEN l.lead_stage = $3 THEN 1 ELSE 0 END)::int AS disqualified,
      SUM(CASE WHEN l.lead_stage = $4 THEN 1 ELSE 0 END)::int AS marketing_prospect,
      SUM(CASE WHEN l.lead_stage = $5 THEN 1 ELSE 0 END)::int AS attempting,
      SUM(CASE WHEN l.lead_stage = $6 THEN 1 ELSE 0 END)::int AS connected,
      SUM(CASE WHEN l.lead_stage = $7 THEN 1 ELSE 0 END)::int AS new_leads
    FROM lead_facts_raw l
    JOIN owner_cache o
      ON o.owner_id::text = l.owner_id::text
    WHERE l.created_at >= now() - interval '90 days'
      AND l.lead_stage <> $8
      AND o.full_name = ANY($9::text[])
    GROUP BY 1
    ORDER BY total DESC;
  `, [
    STAGES.ZOOM_BOOKED,
    STAGES.SALES_QUALIFIED,
    STAGES.DISQUALIFIED,
    STAGES.MARKETING_PROSPECT,
    STAGES.ATTEMPTING,
    STAGES.CONNECTED,
    STAGES.NEW,
    STAGES.NOT_APPLICABLE,
    CONSULTANTS
  ]);

  console.log("=== CONSULTANT LEAD STAGES (90D) ===");
  for (const r of consultantStage.rows) {
    console.log(
      `${r.owner_name} | total=${r.total} | zoom_booked=${r.zoom_booked} | sales_qualified=${r.sales_qualified} | disq=${r.disqualified} | marketing_prospect=${r.marketing_prospect} | connected=${r.connected} | attempting=${r.attempting} | new=${r.new_leads}`
    );
  }

  const disqReasons = await pool.query(`
    SELECT
      o.full_name AS owner_name,
      COALESCE(l.disqualification_reason, 'NO_REASON') AS reason,
      COUNT(*)::int AS cnt
    FROM lead_facts_raw l
    JOIN owner_cache o
      ON o.owner_id::text = l.owner_id::text
    WHERE l.created_at >= now() - interval '90 days'
      AND l.lead_stage = $1
      AND o.full_name = ANY($2::text[])
    GROUP BY 1,2
    ORDER BY owner_name ASC, cnt DESC;
  `, [STAGES.DISQUALIFIED, CONSULTANTS]);

  console.log("");
  console.log("=== CONSULTANT DISQUALIFICATION REASONS (TOP 3) ===");
  const byOwner = new Map();
  for (const r of disqReasons.rows) {
    if (!byOwner.has(r.owner_name)) byOwner.set(r.owner_name, []);
    byOwner.get(r.owner_name).push(r);
  }
  for (const name of CONSULTANTS) {
    const arr = (byOwner.get(name) || []).slice(0, 3);
    const line = arr.map(x => `${x.reason}:${x.cnt}`).join(", ");
    console.log(`${name} | ${line || "(no disqualifications)"}`);
  }

  console.log("STEP16D_OK");
  await pool.end();
}

main().catch(e => {
  console.error(e);
  console.log("STEP16D_FAILED");
  process.exit(1);
});
