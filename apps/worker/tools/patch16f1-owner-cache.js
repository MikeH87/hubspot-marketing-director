const fs = require("fs");

const p = ".\\lib\\gptReport.js";
let s = fs.readFileSync(p, "utf8");

if (!s.includes("async function getConsultantLeadFunnel")) {
  console.error("Could not find getConsultantLeadFunnel in lib/gptReport.js");
  process.exit(1);
}

// Replace the whole getConsultantLeadFunnel() with a schema-aware version.
s = s.replace(
  /async function getConsultantLeadFunnel[\s\S]*?\n}\n\nfunction buildPayload\(/m,
`async function getConsultantLeadFunnel(pool) {
  // Determine which owner name column exists in owner_cache
  const cols = await tableColumns(pool, "owner_cache");
  const nameCol =
    cols.has("owner_name") ? "owner_name" :
    cols.has("full_name") ? "full_name" :
    cols.has("name") ? "name" :
    cols.has("owner_full_name") ? "owner_full_name" :
    null;

  // If we can't find a good name column, fall back to UNASSIGNED (still runs)
  const ownerNameExpr = nameCol ? \`oc.\${nameCol}\` : "null";

  const { rows } = await pool.query(\`
    select
      coalesce(\${ownerNameExpr}, 'UNASSIGNED') as owner_name,
      l.lead_stage as lead_stage,
      l.disqualification_reason as disq_reason,
      count(*)::int as n
    from lead_facts_raw l
    left join owner_cache oc on oc.owner_id::text = l.owner_id::text
    where l.created_at >= (now() - interval '90 days')
      and l.lead_stage is not null
    group by 1,2,3
  \`);

  const byOwner = new Map();

  function ensure(owner) {
    if (!byOwner.has(owner)) {
      byOwner.set(owner, {
        total: 0,
        zoom_booked: 0,
        sales_qualified: 0,
        disqualified: 0,
        marketing_prospect: 0,
        connected: 0,
        attempting: 0,
        new: 0,
        not_applicable: 0,
        disqReasons: new Map(),
      });
    }
    return byOwner.get(owner);
  }

  for (const r of rows) {
    const owner = r.owner_name || "UNASSIGNED";
    if (!CONSULTANT_NAMES.has(owner)) continue;

    const b = ensure(owner);
    const stage = r.lead_stage;
    const n = num(r.n);

    b.total += n;

    if (stage === LEAD_STAGE.ZOOM_BOOKED) b.zoom_booked += n;
    else if (stage === LEAD_STAGE.SALES_QUALIFIED) b.sales_qualified += n;
    else if (stage === LEAD_STAGE.DISQUALIFIED) b.disqualified += n;
    else if (stage === LEAD_STAGE.MARKETING_PROSPECT) b.marketing_prospect += n;
    else if (stage === LEAD_STAGE.CONNECTED) b.connected += n;
    else if (stage === LEAD_STAGE.ATTEMPTING) b.attempting += n;
    else if (stage === LEAD_STAGE.NEW) b.new += n;
    else if (stage === LEAD_STAGE.NOT_APPLICABLE) b.not_applicable += n;

    if (stage === LEAD_STAGE.DISQUALIFIED) {
      const reason = String(r.disq_reason || "NO_REASON");
      b.disqReasons.set(reason, (b.disqReasons.get(reason) || 0) + n);
    }
  }

  const out = [];
  for (const [owner, b] of byOwner.entries()) {
    // callable = excluding Marketing Prospect + Not Applicable
    const callable = Math.max(0, b.total - b.marketing_prospect - b.not_applicable);
    const disqRate = callable > 0 ? b.disqualified / callable : 0;
    const zoomRate = callable > 0 ? b.zoom_booked / callable : 0;

    const topReasons = [...b.disqReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => \`\${k}:\${v}\`);

    out.push({ owner, ...b, callable, disqRate, zoomRate, topReasons });
  }

  out.sort((a, b) => b.callable - a.callable);
  return out;
}

function buildPayload(`
);

fs.writeFileSync(p, s, "utf8");
console.log("PATCH_OWNER_CACHE_OK");
