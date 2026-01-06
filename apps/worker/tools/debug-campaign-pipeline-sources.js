require("dotenv/config");
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
if (!DATABASE_URL) { console.error("Missing DATABASE_URL"); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
});

async function cols(table) {
  const { rows } = await pool.query(
    "select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",
    [table]
  );
  return rows;
}

(async () => {
  const tables = ["campaign_context_snapshot_90d", "lead_facts_raw"];
  for (const t of tables) {
    const c = await cols(t).catch(e => ({ error: e.message }));
    console.log("TABLE_COLS", t, c);
  }

  // Pull a single campaign snapshot row to see lifecycle_counts keys we can rely on
  const snap = await pool.query("select lifecycle_counts from campaign_context_snapshot_90d limit 1").catch(() => ({ rows: [] }));
  const lc = snap.rows?.[0]?.lifecycle_counts || {};
  console.log("LIFECYCLE_COUNTS_KEYS_SAMPLE", Object.keys(lc).sort());

  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
