-- Minimal schema (worker creates reports if missing)
CREATE TABLE IF NOT EXISTS reports (
  week_start DATE PRIMARY KEY,
  summary TEXT
);
