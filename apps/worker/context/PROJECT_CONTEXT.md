# HubSpot → Postgres → OpenAI Marketing Reporting (TLPI) — Project Context

## Working Baseline (confirmed)
- Render worker + cron runs end-to-end, emails weekly marketing report.
- Postgres on Render works.
- HubSpot API access works: campaigns, contacts, deals.
- Deals pulled via POST /crm/v3/objects/deals/search.
- 90-day campaign snapshots stored in `campaign_context_snapshot_90d`.
- `deal_ids_90d` backfilled correctly; dealtype rollups created.
- Emails sent via SMTP (Gmail app password), from admin@thelandlordspension.net to mike@tlpi.co.uk.
- Cron command (working):
  node ./tools/backfill-deal-ids-90d.js &&
  node ./tools/rollup-dealtype-90d.js &&
  node ./tools/run-report-once.js

## Accuracy rules already implemented
- Exclude operational contacts: product_type in {"Additional Member","Additional Director"}.
- Exclude non-sales deal types from revenue/win rollups: {"SSAS","FIC"}.
- Attribution (current): deals → associated contacts → first non-excluded contact with valid converting campaign; campaign must exist in snapshot window.

## Identified reporting gaps (from management email review)
- No true ad spend by period across platforms → ROAS not defensible.
- Remarketing undercount: contacts created outside 90d can convert later.
- Funnel drop-offs lack diagnosis (need loss reasons).
- Lifecycle stage resets distort “current stage” funnel analysis.
- No speed metrics (form→lead→SQL→deal→won).
- Offline/CRM attribution ambiguity needs explicit classification.
- Owner-level performance insights (conversion + speed) valuable.

## Agreed solution direction (locked)
### Attribution model
- Primary: U-shaped attribution: 60% first meaningful touch + 40% last meaningful touch before deal creation.
- Interaction ranking (strongest first): marketing form submit (non-operational) → meeting booked w/ UTMs → lead created from marketing source → weaker contact-source-only signals.
- Never drop records; classify as:
  - marketing_attributed / marketing_influenced / non_marketing_offline
  with explicit reasons.

### Spend model (must be daily + by period)
- Go straight to Stage 2:
  - Pull daily spend for Facebook/Google/LinkedIn via HubSpot Ads API (if accessible and mappable).
  - Use campaign spend items for Bing (API-inserted daily items) + Twitter (manual daily items).
- Normalise all spend into daily rows in Postgres; compute 30/90-day spend from daily rows only.

### Diagnostics + performance
- Include lead + deal loss reasons:
  - Lead: hs_lead_disqualification_reason (e.g., Invalid Phone Number, Not Contactable, Not Eligible, etc.)
  - Deal: closed_lost_reasons (e.g., Too expensive, Lost contact, etc.)
- Add speed metrics:
  - form submit → lead created → SQL reached → deal created → won/lost
  - ability to query average time new lead → sale later.
- Add owner-level insights (lead owner / deal owner):
  - conversion rates, speed metrics, and loss reason patterns (aggregate + outlier-focused).

## Implementation safety approach
- Audit-first, additive changes:
  1) Audit scripts (no DB writes) to verify:
     - form submissions have UTMs and which forms are operational
     - spend coverage and granularity by platform
     - loss reason completeness in last 90d
  2) Add new tables + ingestion scripts (behind feature flag / separate cron step).
  3) Add rollups + reporting changes only after audits pass.
- Keep current cron untouched until new pipeline validated.


## Audit findings (Jan 2026)

### Form submissions + UTMs
- Form submissions API returns objects with keys: conversionId, pageUrl, submittedAt, values.
- UTM fields are present in submission values: utm_source, utm_medium, utm_campaign, utm_term, utm_content.
- Last 90 days audit:
  - Total submissions analysed: 703
  - Email present: 690 (98.2%)
  - Core UTMs (source+medium+campaign) present: 633 (90.0%)
- Conclusion: Attribution should use UTMs from submission payload + email join, not contact UTM properties.

### Campaign API shape
- marketing/v3/campaigns returns campaigns with empty properties unless explicitly requested.
- Campaign name property is hs_name (not name).
  - Example: properties: {"hs_name":"All emails start Nurture: All Products"}

### Spend API availability
- HubSpot Ads endpoints under /ads/... returned HTTP 404 in this portal for reporting/accounts/campaigns.
- Campaign spend endpoints probed:
  - GET /marketing/v3/campaigns/{id}/spend returns HTTP 405 (Method Not Allowed)
  - Other guessed spend item read endpoints returned 400/404.
- Conclusion: Do not assume HubSpot exposes daily spend via API. For accurate ROAS by period, store daily spend in Postgres sourced from native ad platform APIs (Meta/Google/LinkedIn) + existing Bing/Twitter spend items where available.

