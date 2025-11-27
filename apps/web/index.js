const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
});

// Health
app.get("/health", async (req, res) => {
  try {
    if (process.env.DATABASE_URL) await pool.query("select 1;");
    res.json({ ok: true, service: "web", db: !!process.env.DATABASE_URL });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Latest report
app.get("/reports/latest", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "select week_start, summary from reports order by week_start desc limit 1;"
    );
    res.json({ ok: true, latest: rows[0] || { week_start: null, summary: "No report yet — run the worker first." } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Campaigns count
app.get("/campaigns/count", async (req, res) => {
  try {
    const r = await pool.query("select count(*)::int as count from campaigns;");
    res.json({ ok: true, count: r.rows[0].count });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Snapshots count
app.get("/snapshots/count", async (req, res) => {
  try {
    const r = await pool.query("select count(*)::int as count from campaign_snapshots;");
    res.json({ ok: true, count: r.rows[0].count });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Snapshots sample (most recent)
app.get("/snapshots/sample", async (req, res) => {
  try {
    const q = `
      select campaign_id, captured_at, raw_json
      from campaign_snapshots
      order by captured_at desc
      limit 1;
    `;
    const { rows } = await pool.query(q);
    if (!rows.length) return res.json({ ok: true, sample: null });

    const row = rows[0];
    const obj = row.raw_json || {};
    const keys = obj && typeof obj === "object" ? Object.keys(obj) : [];
    // return top-level keys and the first 1KB of the JSON string for inspection
    const rawStr = JSON.stringify(obj);
    const preview = rawStr.length > 1024 ? rawStr.slice(0, 1024) + "…(truncated)" : rawStr;

    res.json({
      ok: true,
      sample: {
        campaign_id: row.campaign_id,
        captured_at: row.captured_at,
        top_level_keys: keys,
        raw_preview: preview
      }
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.listen(PORT, () => console.log(`Web running on :${PORT}`));
