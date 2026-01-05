# Marketing Director – Build Plan (Reporting Model + Implementation)

## 0) Goal (what “correct” means)

We need one weekly email/report that is:
- **Accurate on totals** (especially Sales revenue won in the last 90 days).
- **Useful for action**:
  - Marketing performance by campaign (volume → quality → pipeline → revenue).
  - Sales performance by consultant (conversion + disqualification patterns).
- **Transparent about attribution**:
  - Attributed vs Unattributed must be shown explicitly; unattributed must not disappear.

## 1) Core objects and “single source of truth”

### 1.1 Contacts (HubSpot CONTACT)
We use contacts to represent the prospect identity and campaign/UTM context.

Key fields we rely on:
- `product_type` (Contact Type) — used for exclusions (e.g. Additional Member/Director)
- `hs_lead_status` (Contact Lead Status) — your operational progression for prospects
- `lifecyclestage` — higher-level lifecycle stage
- UTM + campaign attribution fields (examples we already use in code):
  - `utm_campaign`
  - `hs_analytics_last_touch_converting_campaign`
  - `hs_analytics_first_touch_converting_campaign`
  - `engagements_last_meeting_booked_campaign`
  - `hs_manual_campaign_ids`
  - plus any custom Facebook fields (e.g. `facebook_ad_name`) if needed

### 1.2 Leads (HubSpot LEAD)
Leads represent the “lead pipeline record” (system-created via workflows in TLPI).

Key fields:
- `hs_pipeline_stage` (Lead Prospect Stage)
- `lead_status` / `lead_stage` (as pulled into `lead_facts_raw` table)
- `disqualification_reason` (we now store this, not `hs_lead_disqualification_reason`)

IMPORTANT: Leads must be included even if there is no deal, because lead performance is part of the value of this system.

### 1.3 Deals (HubSpot DEAL)
Deals represent pipeline + revenue.

We have two pipelines:
- **Sales Pipeline** (the one we care about for revenue reporting)
- Product pipeline (SSAS/FIC product management) — excluded from Sales revenue reporting

Revenue rules:
- **Revenue won** uses `amount` on the Deal (not `total_no_of_sales * 4500`).
- `total_no_of_sales` is still useful as a separate “units sold” metric.

Closed-won definition:
- Sales won stage id: `1054943521` (Agreement Signed (Won) – Sales Pipeline)

## 2) Time windows (reporting logic)

We need to support:
- **Sales revenue won in the last 90 days**, based on **deal close date** (closedate), not createdate.
- Leads created in the last 90 days (lead created date).
- Contacts created in the last 90 days (contact create date).

We also need the executive summary split:
- Revenue won in last 90 days from **new prospects (≤30 days old at time of win)** vs **older prospects**.
  - Definition: prospect age = (deal close date) – (contact create date)
  - If contact create date missing, fall back to earliest known lead create date; else classify as “unknown age”.

## 3) Attribution model (campaign matching)

We must attribute metrics to a “campaign key” consistently, but also not lose data if we can’t.

### 3.1 Campaign key hierarchy (best → worst)
1) Nearest form submission UTMs (best)
2) Contact UTMs / converting campaign fields
3) Unattributed bucket

This is already the spirit of our lead loss rollup: “form UTMs → contact UTMs → UNATTRIBUTED”.

### 3.2 Matching to snapshot campaign rows
We keep snapshot rows as the “known campaign list”, but we must not require a match to count totals.

So every metric is computed twice:
- **Total** (truth total; does not require snapshot match)
- **Attributed** (only where we can map to a snapshot campaign key)
- **Unattributed** (everything else)

This prevents “missing deals” causing totals to be wildly wrong.

## 4) Data pipeline (what tables/jobs exist)

### 4.1 Existing snapshot-based reporting
`apps/worker/lib/gptReport.js` currently pulls from `campaign_context_snapshot_90d` for:
- sessions_90d, new_contacts_90d, lifecycle_counts, asset_counts
and applies explicit rules for Sales revenue fields:
- sales won revenue = `revenue_won_90d_sales`
- sales pipeline created = `pipeline_created_90d_sales`
(Do not treat product pipeline deals as revenue wins.)

### 4.2 Existing deal attribution method (snapshot-only)
Current tooling backfills deal IDs into snapshot rows by:
- pulling deals created in window
- finding associated contacts
- taking the first campaign-like value on contact from a priority list
- matching that value to snapshot rows by campaign_id (UUID) or normalised campaign_name
This explains why totals can be far below HubSpot reality: if the campaign key doesn't match a snapshot row, the deal is effectively dropped from rollups.

## 5) What we are changing (high confidence plan)

### 5.1 Add a Sales “truth totals” layer (new table)
Create a table that stores the 90-day totals from Sales pipeline regardless of attribution:
- total_sales_deals_won_90d
- total_sales_revenue_won_90d
- total_sales_units_sold_90d (sum total_no_of_sales, optional)
- total_sales_deals_created_90d
- total_sales_pipeline_created_90d
- plus age split: revenue from prospects created ≤30d vs >30d

This becomes the executive summary baseline.

### 5.2 Add an “Unattributed” bucket to campaign_context_snapshot_90d (or a separate rollup table)
Option A: Add a synthetic snapshot row with campaign_key = 'UNATTRIBUTED'
Option B: Keep unattributed metrics in a separate rollup table keyed by window

We will prefer Option B (cleaner), unless you explicitly want to see “UNATTRIBUTED” beside campaigns.

### 5.3 Keep lead-based reporting intact, but fix “qualified” definition
In the email, “qualification rate = 0%” is wrong because we were likely mapping qualification incorrectly.

Correct qualification definition (per your instruction):
- “Qualified lead” should be counted when contact `hs_lead_status` reaches **Qualified Prospect** (Zoom call booked).
(We will still show other stages: Connect & Qualify, Consultation Complete, Case Won, Not Proceeding, Marketing Prospect.)

Also exclude:
- Contacts where `product_type` indicates Additional Member / Additional Director
- Contacts/Leads where status = Not Applicable (so they don’t distort conversion rates)

### 5.4 Owner performance needs proper denominators
Owner performance should be computed from contacts/leads assigned to that owner, with:
- counts entering each stage
- conversion rates between stages
- disqualification reason distribution
- significant outlier detection (e.g. 2× worse contactability than median)

This requires owner id → name mapping (either via HubSpot owners endpoint, or a cached table).

## 6) Report output structure (new email format)

### Section A — Marketing Performance (campaign lens)
- Totals (contacts/leads created, MQL/SQL counts, pipeline created, revenue won)
- Top campaigns by:
  - new prospects
  - qualified prospects (Zoom booked)
  - pipeline created
  - revenue won
- Lead quality: disqualification reasons by campaign
- Unattributed: show its totals, and top causes (missing UTMs, missing converting campaign, etc.)

### Section B — Sales Performance (consultant lens)
- Total leads/prospects handled per consultant
- Stage conversion rates (New → Connect&Qualify → Qualified → Consultation Complete → Case Won)
- Disqualification rate + top reasons
- Outliers called out explicitly (“X has 2.4× invalid phone rate vs median”)
- Revenue won per consultant (Sales pipeline only)

### Section C — Data confidence / gaps
- What’s missing and how it impacts decisions
- A short, prioritised fix list

## 7) Implementation steps (sequenced)

1) Add “truth totals” rollup script for Sales deals closed-won by close date (90d).
2) Add attribution breakdown (Attributed vs Unattributed) for Sales revenue/pipeline.
3) Add owner lookup cache + owner performance rollups.
4) Update GPT payload to include:
   - truth totals
   - attributed/unattributed breakdown
   - owner performance summary
   - disqualification reasons summary
5) Update prompts to enforce:
   - never claim “0% qualification” unless counts confirm
   - always include unattributed totals
   - split marketing vs sales sections

## 8) Validation checklist (must pass before Render deploy)

- HubSpot UI report: Sales closed-won deals in last 90 days == our total_sales_deals_won_90d
- HubSpot UI sum(amount) for those deals == our total_sales_revenue_won_90d
- Unattributed + attributed == total (for key metrics)
- Lead totals match ingestion counts (after exclusions)
- One spot-check campaign: manually verify a few deals + associated contact attribution

