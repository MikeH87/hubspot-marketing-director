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
-- Raw per-campaign analytics snapshots (store raw JSON now, map later)
CREATE TABLE IF NOT EXISTS campaign_snapshots (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  campaign_id TEXT NOT NULL,
  account_id TEXT NULL,
  raw_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_campaign_id ON campaign_snapshots(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_captured_at ON campaign_snapshots(captured_at);
