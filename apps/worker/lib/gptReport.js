const fs = require("fs");
const path = require("path");

const OpenAIImport = require("openai");
const OpenAI = OpenAIImport.default || OpenAIImport;

/**
 * Generate a meeting-ready 90-day marketing performance report from campaign_context_snapshot_90d.
 * Returns null if OPENAI_API_KEY isn't set.
 */
async function generateGptReport({ pool }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4.1";
  const temperature = process.env.OPENAI_TEMPERATURE ? Number(process.env.OPENAI_TEMPERATURE) : 0.2;

  // Pull the latest window we captured (rolling 90d)
  const { rows: winRows } = await pool.query(`
    SELECT window_start, window_end
    FROM campaign_context_snapshot_90d
    ORDER BY window_end DESC, captured_at DESC
    LIMIT 1;
  `);

  if (!winRows.length) {
    return "No 90-day snapshot data found yet in campaign_context_snapshot_90d.";
  }

  const windowStart = winRows[0].window_start;
  const windowEnd = winRows[0].window_end;

  // Pull snapshot rows for that window (limit to keep prompt sane)
  const { rows } = await pool.query(
    `
    SELECT
      campaign_id,
      campaign_name,
      campaign_status,
      campaign_type,
      campaign_channel,
      planned_budget,
      currency,
      sessions_90d,
      new_contacts_90d,
      lifecycle_counts,
      asset_counts
    FROM campaign_context_snapshot_90d
    WHERE window_start = $1 AND window_end = $2
    ORDER BY COALESCE(new_contacts_90d,0) DESC
    LIMIT 120;
    `,
    [windowStart, windowEnd]
  );

  const payload = rows.map(r => ({
    campaign_key: r.campaign_id,
    campaign_name: r.campaign_name,
    status: r.campaign_status,
    type: r.campaign_type,
    channel: r.campaign_channel,
    planned_budget: r.planned_budget,
    currency: r.currency,
    sessions_90d: r.sessions_90d,
    new_contacts_90d: r.new_contacts_90d,
    lifecycle_counts: r.lifecycle_counts,
    asset_mix: r.asset_counts
  }));

  // Load company context
  const ctxPath = path.join(__dirname, "company_context.md");
  const companyContext = fs.existsSync(ctxPath) ? fs.readFileSync(ctxPath, "utf8") : "";

  const system = `
You are a senior marketing performance analyst for TLPI (UK).
You produce internal, decision-ready marketing meeting notes.
Use British English. Avoid generic advice. Never invent missing data.
`.trim();

  const user = `
${companyContext}

You are reviewing TLPIâ€™s marketing performance using HubSpot-derived snapshots.

CRITICAL: Analyse ONLY the most recent 90 days (rolling window).
Window: ${windowStart} to ${windowEnd}

Data notes:
- "campaign_key" is the best available campaign identifier (often utm_campaign or HubSpot converting campaign fields).
- sessions_90d may be null; do not assume it exists.
- asset_mix contains source/medium distribution (UTM + HubSpot latest source breakdown).

Your task:
Produce a short-term (90-day) marketing performance report for the weekly marketing meeting.

IMPORTANT revenue rules (do not break these):
- "Sales won revenue" = revenue_won_90d_sales (Sales Pipeline only).
- "Sales pipeline created" = pipeline_created_90d_sales.
- Do NOT treat Product Pipeline deals as new revenue wins.
- If SALES fields are missing for a campaign key, say so; do not infer.

Output format:

1) Executive summary (4â€“6 bullets)
   - short-term efficiency, scale potential, risks

2) Campaign-level actions (only where action is warranted)
   For each:
   - Campaign name/key
   - What to do (scale / pause / refine / monitor)
   - Why (cite the specific fields)
   - Risk if no action

3) Funnel efficiency insights
   - where prospects stall (Lead â†’ MQL â†’ SQL)
   - which sources/campaigns show poor progression

4) Asset/source mix observations
   - source/medium patterns
   - any â€œtraffic but no progressionâ€ signals

5) Data gaps that materially limit confidence (prioritised)
   - be specific and practical

Snapshot data (JSON):
${JSON.stringify(payload).slice(0, 180000)}
`.trim();

  const client = new OpenAI({ apiKey });

  const resp = await client.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  return resp.choices?.[0]?.message?.content?.trim() || null;
}

module.exports = { generateGptReport };
