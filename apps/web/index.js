const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// Single shared pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
});

// Health
app.get("/health", async (req, res) => {
  try {
    if (process.env.DATABASE_URL) {
      await pool.query("select 1;");
    }
    res.json({ ok: true, service: "web", db: !!process.env.DATABASE_URL });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Latest report (placeholder)
app.get("/reports/latest", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "select week_start, summary from reports order by week_start desc limit 1;"
    );
    res.json({ ok: true, latest: rows[0] || { week_start: null, summary: "No report yet — run the worker first." } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// NEW: campaigns count
app.get("/campaigns/count", async (req, res) => {
  try {
    const r = await pool.query("select count(*)::int as count from campaigns;");
    res.json({ ok: true, count: r.rows[0].count });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`Web running on :${PORT}`));
