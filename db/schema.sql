-- Reports table (already used)
CREATE TABLE IF NOT EXISTS reports (
  week_start DATE PRIMARY KEY,
  summary TEXT
);

-- NEW: HubSpot campaigns master table
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  app_id INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
