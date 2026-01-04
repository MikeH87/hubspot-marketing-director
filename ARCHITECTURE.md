# Marketing Reporting Architecture (HubSpot → Postgres → OpenAI → Email)

## Purpose
Produce a boardroom-defensible, repeatable 90-day rolling marketing performance report that is:
- Accurate and auditable (data lineage, rules, fallbacks are explicit)
- Non-generic and action-focused (funnel, campaign, revenue attribution, diagnostics)
- Automated (runs twice weekly on Render; emails management-ready output)

## Design principles
1. **HubSpot is the system of record for CRM events** (forms, contacts, leads, deals, owners, stages, loss reasons).
2. **Postgres is the analytics source of truth** (append-only facts + deterministic rollups).
3. **OpenAI summarises only** (no attribution logic, no maths, no data shaping).
4. **Never rely on mutable “current stage” fields alone** (stages can reset). Prefer event timestamps / history logic.
5. **Prefer additive changes** (new tables + new scripts) to protect the working cron pipeline.

## Current working pipeline (baseline)
Render cron (working end-to-end):
- `node ./tools/backfill-deal-ids-90d.js`
- `node ./tools/rollup-dealtype-90d.js`
- `node ./tools/run-report-once.js`

Existing key tables (baseline)
- `campaign_context_snapshot_90d` (campaign snapshots + deal_ids_90d backfilled)
- dealtype rollups by excluded/allowed deal types

Existing accuracy rules (baseline)
- Exclude operational contacts: product_type in {"Additional Member","Additional Director"}
- Exclude non-sales deal types from revenue & win rollups: {"SSAS","FIC"}
- Attribution (baseline): deals → associated contacts → first non-excluded contact with converting campaign inside snapshot window

## Audit findings (locked)
### Form submissions + UTMs
- Form submissions API returns keys: `conversionId`, `pageUrl`, `submittedAt`, `values`
- UTMs exist in submission `values`: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- Last 90 days audit:
  - Total submissions analysed: 703
  - Email present: 690 (98.2%)
  - Core UTMs (source+medium+campaign) present: 633 (90.0%)
- Conclusion: **use UTMs from submission payload** + **email join** (submission → contact/lead/deal)

### HubSpot spend APIs
- `/ads/...` endpoints returned 404 in this portal
- Campaign spend reads via simple GET were not available (405/400/404 patterns)
- Conclusion: **do not depend on HubSpot Ads tool API for daily spend reads**

### Campaign naming via API
- Campaign list/detail returns empty `properties` unless explicitly requested
- Campaign name property is **`hs_name`** (not `name`)

## Target end-state architecture

### Data flow
1. **Extract** (HubSpot + ad platforms) → Postgres (raw facts)
2. **Transform** (Postgres SQL / deterministic scripts) → rollup tables
3. **Compose report dataset** → JSON payload
4. **Summarise** via OpenAI → structured narrative
5. **Email** via SMTP

### Core data sources
- HubSpot:
  - Form submissions (UTMs + email)
  - Contacts (exclusions + owner + properties for segmentation)
  - Leads (stages + loss reasons)
  - Deals (stages + amounts + dealtype + loss reasons)
  - Associations: deal↔contact, lead↔contact, etc.
- Spend:
  - Stored in Postgres as daily rows (platform APIs; Bing/Twitter via existing mechanisms)

## Deterministic attribution specification (v2)
### Primary join key
- **Email** from form submission payload ↔ HubSpot contact(s)

### Primary marketing touch evidence
- Form submission UTMs from submission payload (`utm_campaign`, `utm_source`, `utm_medium`, etc.)

### Attribution window concept
- A deal is in-scope if it has activity in the rolling 90-day window (created/closed/stage-changed depending on metric).
- Attribution should not be limited to “contact created in last 90 days”.

### Attribution model
- **U-shaped split**:
  - 60% to **first meaningful marketing touch** (first UTM’d form submission for that email)
  - 40% to **last meaningful marketing touch before deal creation** (last UTM’d form submission before deal created date)
- If only one meaningful touch exists: allocate 100% to that touch.
- If no meaningful marketing touches exist: classify as **Unattributed / Offline / Operational** (do not force attribution).

### Exclusions and fallbacks
- Exclude operational forms by name contains “Practitioner”
- Additional operational filters:
  - if submission has no UTMs → treat as non-marketing unless explicitly classified otherwise
- Maintain existing contact exclusions and dealtype exclusions.

### Attribution outputs (stored)
For each deal in-scope, store:
- attributed_campaign_first (utm_campaign)
- attributed_campaign_last (utm_campaign)
- attributed_weight_first, attributed_weight_last
- attribution_reason (why classified / why not)

## Funnel + diagnostics specification (v2)
### Why lifecycle stage alone is insufficient
- Contacts can be reset back to lead, losing the “how far they got” story.

### What to compute instead
From leads + deals (and timestamps):
- Counts entering each stage (MQL, SQL, Opportunity/Deal created, Won, Lost)
- **Loss reasons** (lead + deal) aggregated by utm_campaign / channel / owner
- Conversion rates per stage transition
- “Speed” metrics:
  - submit → lead created
  - lead created → SQL
  - SQL → deal created
  - deal created → closed won/lost

### Owner performance
Store and report:
- Lead owner performance (qualification speed, disqualification reasons)
- Deal owner performance (win rate, time-to-close, loss reasons)

## Postgres data model (planned additions)
These are additive tables to avoid breaking the baseline pipeline.

### Raw facts
- `form_submissions_raw`
  - submitted_at, form_name, page_url, email, utm_source, utm_medium, utm_campaign, utm_term, utm_content, raw_values_json
- `ad_spend_daily`
  - spend_date, platform, account_id, utm_campaign (or campaign_key), currency, spend_amount, raw_json

### Derived/rollups
- `deal_attribution_v2_90d`
  - deal_id, first_touch_campaign, last_touch_campaign, weights, reasons, computed_at
- `campaign_performance_90d`
  - utm_campaign, contacts/leads/deals counts by stage, revenue attributed, spend, ROAS, speed metrics, top loss reasons
- `owner_performance_90d`
  - owner_id, owner_name, stage conversion, speed, loss reasons

## Operational model (Render)
- Keep current cron unchanged until v2 is validated.
- Add new scripts as separate steps:
  1) backfill/ingest forms (90d)
  2) ingest spend daily (90d)
  3) compute attribution v2 rollups
  4) produce report v2
- Once validated, replace the email report generator to use v2 rollups.

## Reliability & safety controls
- Idempotent upserts (unique keys on raw tables)
- Rate limiting and retry/backoff for APIs
- Logging with correlation IDs and “counts processed”
- Guardrails:
  - If spend missing for a platform, report “Spend incomplete” section rather than guessing
  - If attribution evidence missing, classify explicitly rather than forcing

## Definition references
See:
- `apps/worker/context/PROJECT_CONTEXT.md`
- `Hubspt_Definitions.ods` for stage definitions and loss reasons (lead + deal)

