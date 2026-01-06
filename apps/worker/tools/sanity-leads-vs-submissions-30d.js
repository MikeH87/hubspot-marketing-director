const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)."); console.log("STEP11G_FAILED"); process.exit(1); }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const q = await client.query(`
    WITH leads30 AS (
      SELECT
        l.lead_id,
        l.created_at,
        c.email
      FROM lead_facts_raw l
      JOIN lead_contact_map m ON m.lead_id = l.lead_id
      JOIN contact_email_cache c ON c.contact_id = m.contact_id
      WHERE l.created_at >= NOW() - interval '30 days'
        AND c.email IS NOT NULL AND c.email <> ''
    ),
    joined AS (
      SELECT
        l.lead_id,
        l.created_at,
        l.email,
        -- closest submission within [-14d, +3d]
        EXISTS (
          SELECT 1
          FROM form_submissions_raw f
          WHERE lower(f.email) = lower(l.email)
            AND f.submitted_at >= (l.created_at - interval '14 days')
            AND f.submitted_at <= (l.created_at + interval '3 days')
        ) AS has_near_submission,
        -- any submission at all (within what we've ingested)
        EXISTS (
          SELECT 1
          FROM form_submissions_raw f
          WHERE lower(f.email) = lower(l.email)
        ) AS has_any_submission
      FROM leads30 l
    )
    SELECT
      COUNT(*)::int AS leads_30d,
      SUM(CASE WHEN has_near_submission THEN 1 ELSE 0 END)::int AS has_recent_submission,
      SUM(CASE WHEN (NOT has_near_submission) AND has_any_submission THEN 1 ELSE 0 END)::int AS has_submission_outside_window,
      SUM(CASE WHEN (NOT has_any_submission) THEN 1 ELSE 0 END)::int AS no_submission_for_email
    FROM joined;
  `);

  const r = q.rows[0];

  console.log("=== 30-DAY SANITY CHECK (LEADS vs FORM SUBMISSIONS) ===");
  console.log(`Leads created (30d): ${r.leads_30d}`);
  console.log(`Has near submission (-14d to +3d): ${r.has_recent_submission}`);
  console.log(`Has submission but outside window: ${r.has_submission_outside_window}`);
  console.log(`No submission for email: ${r.no_submission_for_email}`);
  console.log("STEP11G_OK");

  await client.end();
}

main().catch(e => { console.error(e); console.log("STEP11G_FAILED"); process.exit(1); });
