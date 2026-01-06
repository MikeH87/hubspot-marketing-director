const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!connectionString) { console.error("Missing DATABASE_URL (or RENDER_DATABASE_URL)."); console.log("STEP12C_FAILED"); process.exit(1); }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const q = await client.query(`
    WITH leads90 AS (
      SELECT
        l.lead_id,
        l.created_at,
        COALESCE(NULLIF(l.disqualification_reason, ''), 'NO_REASON') AS loss_reason
      FROM lead_facts_raw l
      WHERE l.created_at >= NOW() - interval '90 days'
    ),
    lead_email AS (
      SELECT
        l.lead_id,
        l.created_at,
        l.loss_reason,
        c.email,
        c.utm_campaign AS contact_utm_campaign,
        c.utm_source   AS contact_utm_source,
        c.utm_medium   AS contact_utm_medium
      FROM leads90 l
      JOIN lead_contact_map m ON m.lead_id = l.lead_id
      JOIN contact_email_cache c ON c.contact_id = m.contact_id
      WHERE c.email IS NOT NULL AND c.email <> ''
    ),
    lead_form_best AS (
      SELECT
        le.*,
        f.utm_campaign AS form_utm_campaign,
        f.utm_source   AS form_utm_source,
        f.utm_medium   AS form_utm_medium
      FROM lead_email le
      LEFT JOIN LATERAL (
        SELECT
          f.utm_campaign, f.utm_source, f.utm_medium
        FROM form_submissions_raw f
        WHERE lower(f.email) = lower(le.email)
          AND f.submitted_at >= (le.created_at - interval '14 days')
          AND f.submitted_at <= (le.created_at + interval '3 days')
        ORDER BY
          CASE WHEN f.submitted_at <= le.created_at THEN 0 ELSE 1 END,
          ABS(EXTRACT(EPOCH FROM (le.created_at - f.submitted_at))) ASC
        LIMIT 1
      ) f ON TRUE
    ),
    attributed AS (
      SELECT
        loss_reason,
        COALESCE(NULLIF(form_utm_campaign,''), NULLIF(contact_utm_campaign,''), 'UNATTRIBUTED') AS utm_campaign
      FROM lead_form_best
    )
    SELECT utm_campaign, loss_reason, COUNT(*)::int AS cnt
    FROM attributed
    GROUP BY utm_campaign, loss_reason
    ORDER BY cnt DESC;
  `);

  const byReason = new Map();
  const byCampaign = new Map();

  for (const r of q.rows) {
    const reason = r.loss_reason;
    const camp = r.utm_campaign;
    const cnt = Number(r.cnt || 0);

    byReason.set(reason, (byReason.get(reason) || 0) + cnt);
    byCampaign.set(camp, (byCampaign.get(camp) || 0) + cnt);
  }

  const reasonSorted = [...byReason.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10);
  const campSorted = [...byCampaign.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10);

  const totalDisq = [...byCampaign.values()].reduce((s,v) => s + v, 0);
  const unattributed = byCampaign.get("UNATTRIBUTED") || 0;

  console.log("=== LEAD LOSS REASON ROLLUP (90D) — WITH CONTACT UTM FALLBACK ===");
  console.log("Top reasons (by disqualified count):");
  for (const [k,v] of reasonSorted) console.log(`- ${k}: ${v}`);

  console.log("");
  console.log("Top campaigns (by disqualified count):");
  for (const [k,v] of campSorted) console.log(`- ${k}: ${v}`);

  console.log("");
  console.log(`UNATTRIBUTED: ${unattributed} / ${totalDisq}`);
  console.log("STEP12C_OK");

  await client.end();
}

main().catch(e => { console.error(e); console.log("STEP12C_FAILED"); process.exit(1); });
