const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// Postgres pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
});

// Health check
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

// Basic placeholder endpoint
app.get("/reports/latest", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "select week_start, summary from reports limit 1;"
    ).catch(() => ({
      rows: [{ week_start: null, summary: "No report yet — run the worker first." }]
    }));
    res.json({ ok: true, latest: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`Web running on :${PORT}`));
