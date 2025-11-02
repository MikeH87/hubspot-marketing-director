const { Pool } = require("pg");

function getMostRecentMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().split("T")[0];
}

(async function run() {
  console.log("Worker run started…");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
  });

  try {
    const weekStart = getMostRecentMonday(new Date());
    const summary = `Placeholder report for week starting ${weekStart}`;

    // Create table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        week_start DATE PRIMARY KEY,
        summary TEXT
      );
    `);

    await pool.query(
      "INSERT INTO reports (week_start, summary) VALUES ($1, $2) ON CONFLICT (week_start) DO UPDATE SET summary = EXCLUDED.summary;",
      [weekStart, summary]
    );

    console.log("Inserted placeholder weekly report.");
  } catch (err) {
    console.error("Worker error:", err.message);
  } finally {
    await pool.end();
    console.log("Worker finished.");
  }
})();
