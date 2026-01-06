## Lead / Contact / Deal Unified Reporting Model

### Current State
- Lead stages backfilled
- Consultant filtering implemented
- Revenue truth totals implemented (amount-based)
- Attribution hierarchy live
- Marketing vs Sales separation defined

### Locked Rules
- Marketing Prospect excluded from consultant metrics
- Only Sales Pipeline (723337811) used for revenue
- Product Pipeline excluded
- Revenue uses deal.amount only
- Units sold reported separately via total_no_of_sales

### Known Remaining Issue
- ES module import errors in migration scripts
- migrate-add-sales-truth-totals-table.js requires CJS/ESM alignment

### Execution Constraints
- All actions executed via PowerShell
- Working directory: apps/worker
- No ad spend integrations yet

## 2026-01-06 10:55

**Change**
Fixed Node.js migration tool failure caused by ESM imports in a CommonJS execution context.

**Why**
Node was throwing Cannot use import statement outside a module when running the sales truth totals migration tool. Project standard is CommonJS; minimal change preferred.

**What changed**
Rewrote pps/worker/tools/migrate-add-sales-truth-totals-table.js from ESM (import) to CommonJS (equire) with identical logic.

**Command run**
node apps/worker/tools/migrate-add-sales-truth-totals-table.js

**Proof**
Console output: SALES_TRUTH_TABLE_OK  
Exit code: 0
## 2026-01-06 12:22

**Issue**
Weekly report sometimes showed “Truth totals: Data not available” and/or report generation failed due to mismatched sales_truth_totals_90d schema across environments.

**What we found (proof)**
Connected DB schema for sales_truth_totals_90d is:
- window_start_date (date)
- window_end_date (date)
- deals_won_count (int)
- revenue_won (numeric)
- units_sold (int)
- revenue_new_prospect (numeric)
- revenue_old_prospect (numeric)
- deals_missing_contact (int)
- created_at (timestamptz)
- updated_at (timestamptz)

**Fix**
Updated pps/worker/lib/gptReport.js to recognise this schema and map fields correctly:
- candidates now include the live schema shape first
- dealsWon maps from deals_won_count
- revenueNew maps from evenue_new_prospect
- revenueOld maps from evenue_old_prospect

Also removed ordering that referenced non-existent columns in some environments; query now orders by updated_at desc only.

**Commands run (verification)**
- node apps/worker/tools/debug-sales-truth-cols.js  (confirmed column list above)
- node apps/worker/index.js (RUN_ONCE)  ? weekly report inserted + email sent without report generation error
## 2026-01-06 12:30

**Change**
Improved email formatting by sending an HTML version of the weekly report (Markdown rendered to HTML), while keeping plain-text fallback.

**Why**
Markdown tables render poorly in many email clients when sent as text-only.

**What changed**
- Installed marked in pps/worker for Markdown ? HTML conversion.
- Updated pps/worker/lib/mailer.js to accept and send { text, html }.
- Updated pps/worker/tools/run-report-once.js to generate html via marked.parse(summary) and send both.

**Commands run (verification)**
- npm install marked
- node apps/worker/tools/run-report-once.js  ? “Email sent to mike@tlpi.co.uk”, exit code 0
## 2026-01-06 13:55

**Clarification: Marketing Prospect vs MQL vs SQL (source-of-truth definitions)**
- Marketing Prospect is a *Lead pipeline stage* (lead object) and is NOT the same as MQL.
- MQL/SQL are part of the *Contact lifecycle stage* property (contacts.lifecyclestage), and are NOT the same as Lead pipeline stages.

**What we proved exists in Postgres (linkage for campaign funnel)**
- contact_email_cache has: contact_id + utm_source/utm_medium/utm_campaign
- lead_contact_map maps: lead_id ? contact_id
- lead_facts_raw has: lead_id + lead_stage (+ disqualification_reason, owner_id etc.)
- deal_revenue_rollup_90d has: utm_campaign + deals_won (+ dealtype, avg_days_lead_to_close)
This enables a campaign funnel by utm_campaign using contact linkage.

**Work completed**
- Added data-driven campaign funnel module: pps/worker/lib/campaignFunnel.js
- Wired it into report payload in pps/worker/lib/gptReport.js as payload.campaignFunnel
- Updated report prompt to display campaign funnel tables (Top 3 + Bottom 3 by Zoom-booked rate) using counts from payload only.
- Confirmed email formatting improved (HTML tables styled via 	ools/run-report-once.js).

## 2026-01-06 14:23

### Campaign funnel (90d) implemented via UTM + contact linkage (data-driven)

**Why**
We needed an early-signal campaign funnel for long sales cycles that is 100% DB-backed and does not depend on mutable contact lifecycle stages.

**What changed**
- Added/updated: apps/worker/lib/campaignFunnel.js
  - Computes campaign funnel by utm_campaign for leads created in last 90 days
  - Uses linkage: contact_email_cache (utm_campaign) -> lead_contact_map -> lead_facts_raw
  - Joins deals won counts by utm_campaign from deal_revenue_rollup_90d
- Updated: apps/worker/lib/gptReport.js
  - Adds campaign funnel to payload: payload.campaignFunnel
  - Prompt updated to render Top 3 + Bottom 3 campaigns by Zoom Booked rate using payload counts only (no GPT maths)

**Commands / proof**
- node .\tools\run-report-once.js
  - Output included: 'Email sent to ...' and EXIT_CODE=0
  - Email shows Campaign Funnel Performance (90d) table with columns:
    Leads Total | Non-MQL | MQL-Eligible | Disqualified | SQL | Zoom Booked | Deals Won

## 2026-01 â€“ Campaign Funnel Rebuild

### What changed
- Rebuilt campaign funnel reporting to use lead-stage progression instead of lifecycle stage.
- Fully excluded Not Applicable leads (1109558437) from all metrics.
- Defined MQL-Eligible as Leads Total minus Marketing Prospect.
- Defined SQL as Sales Qualified OR Zoom Booked.
- Treated UNATTRIBUTED as a tracking bucket, not a campaign.

### Why
- Lifecycle stage is not time-safe and changes as contacts progress.
- Board reporting requires early indicators, not just revenue.
- Prior approach obscured true campaign quality.

### Proof
- Funnel tables now reconcile mathematically.
- MQL, SQL, and Zoom Booked counts are auditable per campaign.
- Email output reviewed and validated against raw aggregates.
