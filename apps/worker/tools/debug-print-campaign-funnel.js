require("dotenv/config");
const pg = require("pg");
const { Pool } = pg;

const { getCampaignFunnel90dByUtmCampaign } = require("../lib/campaignFunnel");

const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) { console.error("Missing DATABASE_URL"); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  const funnel = await getCampaignFunnel90dByUtmCampaign(pool, { minLeads: 30, nTop: 5, nBottom: 5 });

  console.log("CAMPAIGN_FUNNEL_KEYS", Object.keys(funnel));
  console.log("TOP_5_SAMPLE", funnel.top);
  console.log("BOTTOM_5_SAMPLE", funnel.bottom);

  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
