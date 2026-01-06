# Application Design & Handover (hubspot-marketing-director)

This document is a detailed handover snapshot of the application design, current status, and next steps to reach the intended end-state. It is written so the project can be resumed in a fresh chat without re-explaining context.

Last updated: 2026-01-06 (based on conversation context)

---

## 1) What this application is

A marketing + sales reporting pipeline that:
- Pulls HubSpot data into Postgres
- Produces weekly “Boardroom” email reports summarising:
  - Marketing performance (campaign attribution, funnel progression, disqualification reasons)
  - Sales performance (consultant-level conversion through lead stages + quality outcomes)
- Uses a consistent attribution model to tie enquiries and outcomes back to campaigns, and highlight what remains unattributed.

---

## 2) Repo + local environment conventions

### 2.1 Local repo path (Windows / PowerShell)
Root:
- `C:\Users\miket\OneDrive - Holtram TLPI\Desktop\hubspot-marketing-director`

Worker app folder (where you run most scripts):
- `C:\Users\miket\OneDrive - Holtram TLPI\Desktop\hubspot-marketing-director\apps\worker`

### 2.2 How we apply changes
- All changes are executed via **PowerShell** commands.
- Patterns commonly used:
  - writing scripts via here-strings:
    - `@' ... '@ | Set-Content -Encoding UTF8 .\tools\some-script.js`
  - then running:
    - `node .\tools\some-script.js`

### 2.3 Environment variables
Common required envs:
- `HUBSPOT_PRIVATE_APP_TOKEN`
- `DATABASE_URL` (Render Postgres)
- sometimes `RENDER_DATABASE_URL`
- sometimes ad platform tokens (Meta etc) but ad spend integrations were intentionally postponed.

Important:
- In new PowerShell windows, you must re-export env vars or rely on `.env.local` loading if scripts call dotenv.

---

## 3) Data model in Postgres (high level)

### 3.1 Ingestion tables (raw-ish)
- `form_submissions_raw` (created via migration)
  - populated by `tools/ingest-form-submissions.js`
  - stores submission-level UTMs and email
  - excludes “Practitioner” forms (13 excluded during runs)
  - uses a local cutoff window to avoid inserting old submissions during pagination

- `lead_facts_raw`
  - populated by lead ingestion scripts (`tools/ingest-leads-90d.js` with slicing)
  - important columns (confirmed):
    - `lead_id`
    - `created_at`
    - `updated_at`
    - `lead_status`
    - `lead_stage`  (was null initially; later backfilled from HubSpot)
    - `owner_id`
    - `disqualification_reason`
    - `created_at_ingested`

- `lead_contact_map`
  - built via `tools/build-lead-contact-map-90d.js`
  - maps leads → contacts via HubSpot associations

- `contact_email_cache`
  - built via `tools/cache-contact-emails.js`
  - maps contacts → email and key attribution fields (also cached facebook_ad_name)
  - showed counts:
    - With utm_campaign: 7925
    - With facebook_ad_name: 5467

- `owner_cache`
  - built via `tools/cache-owners.js`
  - requires HubSpot scope `crm.objects.owners.read`
  - stores owner id → owner name (and possibly more fields; implementation-dependent)

### 3.2 Campaign context snapshot table
- `campaign_context_snapshot_90d`
  - this is the core “rollup” table used by GPT report generation
  - stores per-campaign aggregated counts and rollups such as:
    - contacts_created_90d
    - lifecycle_entered_90d (lead/mql/sql)
    - lifecycle_current counts
    - deals_created_90d_sales
    - deals_won_90d_sales
    - pipeline_created_90d_sales
    - revenue_won_90d_sales
  - In the app code, fields live inside JSON structures such as:
    - `lifecycle_counts`
    - `asset_counts`

---

## 4) Attribution model (implemented)

### 4.1 Hierarchy for campaign attribution
Used in lead loss reason rollups and intended for revenue:

1) nearest form submission UTMs (email join; best)
2) contact UTMs/campaign (fallback)
3) UNATTRIBUTED

This is critical because many enquiries are:
- Facebook lead forms (no website form submission)
- meeting bookings / direct traffic

### 4.2 Why email join exists
HubSpot submission objects we used did not include contact IDs reliably and conversionId mapping failed.

Therefore:
- form submissions are joined via **email**, with a near-time matching approach.

---

## 5) Reporting outputs

### 5.1 Weekly email report sections
Target structure:
- **Executive Summary**
  - Must show “Sales truth totals” for the 90-day window (close date):
    - Total revenue won (amount)
    - Deals won
    - Units sold (total_no_of_sales)
    - New prospects revenue (<=30 days)
    - Old/unknown revenue
  - Must show attribution coverage:
    - Attributed revenue/deals
    - Unattributed revenue/deals (= truth minus attributed)

- **A) Marketing Performance**
  - top campaigns by attributed revenue
  - top campaigns by pipeline created
  - lead quality summary (top disqualification reasons)
  - clear callouts where UTMs are missing / campaigns are unattributed

- **B) Sales Performance (Consultants only)**
  - consultant funnel using Lead pipeline stages (`hs_pipeline_stage` backfilled into `lead_facts_raw.lead_stage`)
  - include:
    - Callable leads (definition depends on stage exclusions)
    - Zoom booked count & rate
    - Sales qualified count & rate
    - Disqualified count & rate
    - Top disqualification reasons per consultant
  - filter sales performance to Consultants only:
    - ideally via team “Consultants” membership (TBC)
    - fallback hard-coded allowlist of 6 names:
      - Jordan Sharpe, Laura McCarthy, Akash Bajaj, Gareth Robertson, David Gittings, Spencer Dunn

### 5.2 Known issue: “Truth totals” missing in latest email
At one point the email displayed:
- “Total Revenue Won (Truth): Data not available”

This indicates the GPT report generator was not pulling in the Step 15B truth totals, or those totals were not stored where the report reads from.

Fix required:
- Persist sales truth totals into Postgres (one row per window), then have `lib/gptReport.js` read them and include them.

---

## 6) Key completed milestones (as of this handover)

### 6.1 Form submissions
- Implemented ingestion of form submissions into Postgres:
  - `tools/ingest-form-submissions.js`
- Confirmed submission UTM coverage is high.
- Confirmed email join feasibility.

### 6.2 Leads
- Implemented sliced lead ingestion to avoid long run failures:
  - `--sliceDays 1`
- Built lead → contact association mapping:
  - `tools/build-lead-contact-map-90d.js`
- Backfilled Lead pipeline stage into DB:
  - `tools/backfill-lead-stage-90d.js` updated 3412 leads
  - Stage distribution included:
    - Disqualified (unqualified-stage-id): 1416
    - Marketing Prospect (1134678094): 1245
    - Connected: 282
    - Attempting: 172
    - Zoom booked: 134
    - Not Applicable (1109558437): 62
    - New: 59
    - Sales qualified (1213103916): 42

### 6.3 Owner name caching
- Added owner cache and resolved scope issues; owners fetched: 38.

### 6.4 Revenue rollups (campaign-attributed)
- Implemented deal revenue rollups attributed to campaigns / contact UTMs with date accuracy.
- Confirmed won stage used: `1054943521`.
- Confirmed revenue uses `amount`.

### 6.5 Sales truth totals (close date)
A “truth totals” script produced:
- Window: 2025-10-06 → 2026-01-05
- Deals won: 66
- Revenue won (amount): £329,064
- Units sold (total_no_of_sales): 73
- Revenue from new prospects (<=30d): £76,764
- Revenue from older/unknown prospects: £252,300
- Deals missing contact createdate: 0

Important:
- These truth totals must appear in the Executive Summary even if unattributed.

---

## 7) Immediate next steps (action list)

### 7.1 Fix tool scripts to CommonJS (avoid ESM import errors)
We repeatedly hit:
- `SyntaxError: Cannot use import statement outside a module`

Standardise tool scripts to:
- `require("dotenv").config()`
- `const { Pool } = require("pg")`
instead of `import`.

This is why your “Step 1 migrate-add-sales-truth-totals-table.js” failed when written with `import`.

### 7.2 Persist sales truth totals to Postgres
- Create table (e.g. `sales_truth_totals_90d`)
- Modify truth totals script to UPSERT into table by window_start/window_end

### 7.3 Update `lib/gptReport.js` to:
- Read truth totals row for the report window
- Include in Executive Summary:
  - Total revenue won (truth)
  - Deals won (truth)
  - Units sold (truth)
  - New vs old revenue split
- Compute unattributed:
  - truth - attributed
  - show unattributed explicitly (not as “0”)

### 7.4 Refine Consultant funnel metrics
- Confirm definitions for “callable leads”:
  - Exclude Lead stage “Not Applicable (1109558437)”
  - Decide whether to include/exclude “Marketing Prospect (1134678094)” from callable totals (business decision; likely exclude for consultant accountability but include for marketing quality)
- Ensure “qualified lead” means **Zoom Booked** stage.

---

## 8) Open questions / data needed (so the next chat doesn’t guess)
Please confirm / provide later:
- Sales pipeline ID (not stage id) to reliably filter Sales deals
- How to identify Product pipeline deals (pipeline id(s))
- Any additional excluded contact types via `product_type` (exact values)
- Whether HubSpot Teams API is available and returns “Consultants” membership reliably

---

End of Design & Handover.
