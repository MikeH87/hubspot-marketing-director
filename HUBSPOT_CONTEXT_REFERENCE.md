# HubSpot Context Reference (TLPI)

This document is a long-term reference for how TLPI HubSpot data should be interpreted for reporting, attribution, marketing performance, and consultant sales performance.

---

## 1) Core Reporting Principles (Locked)

### 1.1 Revenue
- Revenue is always taken from **Deal.amount** (internal name: `amount`).
- We **do not** derive revenue from “units sold” or any fixed price assumption.
- Units sold are reported separately (see `total_no_of_sales`).

### 1.2 Units Sold
- “Units sold” comes from the Deal property **total_no_of_sales** (internal name: `total_no_of_sales`).
- This is useful because a single Closed Won deal may represent multiple product “sales”.
- Units sold must **never** be multiplied to estimate revenue.

### 1.3 Truth Totals vs Attributed Totals
- “Truth totals” mean: *all relevant sales deals*, including unattributed ones.
- “Attributed totals” mean: the subset of truth totals matched to a campaign key via attribution logic.
- Unattributed totals are not errors — they must be counted and reported explicitly.

### 1.4 Marketing vs Sales separation
- Marketing Performance section:
  - Campaign performance
  - Lead quality / disqualification reasons
  - Marketing Prospect volumes (leads not passed to sales)
  - Attribution coverage
- Sales Performance section:
  - Consultant performance
  - Callable lead handling
  - Conversion rates across lead pipeline stages
  - Disqualification reasons by consultant

---

## 2) HubSpot Objects + What We Use Them For

### 2.1 LEAD object (primary for lead performance)
Primary property: `hs_pipeline_stage`

We use the Lead pipeline (“Prospect Qualification”) as the source of truth for:
- Callable leads
- Lead progression
- Sales quality signals (Zoom booked etc.)
- Lead disqualification reasons (where available)

#### Lead pipeline stages (Prospect Qualification)
Pipeline: Prospect Qualification  
Pipeline ID: `lead-pipeline-id` (label discovered via API)

Stage IDs (confirmed):
- New: `new-stage-id`
- Attempting: `attempting-stage-id`
- Connected: `connected-stage-id`
- Sales Qualified: `1213103916`
- Zoom Booked: `qualified-stage-id`
- Disqualified: `unqualified-stage-id`
- Not Applicable (additional Director/Member): `1109558437`
- Marketing Prospect: `1134678094`

##### Callable lead definition (Consultant workload)
Callable leads include ONLY:
- New
- Attempting
- Connected
- Sales Qualified
- Zoom Booked

Callable leads EXCLUDE:
- Marketing Prospect (`1134678094`) — marketing metric only
- Disqualified (`unqualified-stage-id`) — loss outcome
- Not Applicable (`1109558437`) — exclude from all reporting

##### Exclusions (strict)
Exclude ONLY additional director/member leads:
- Lead stage Not Applicable: `1109558437`

No other exclusions should be applied implicitly.

---

### 2.2 CONTACT object (supporting context)
Important contact properties used for attribution and segmentation:
- `hs_lead_status` (Contact “Lead Status” – HubSpot naming is confusing)
- `lifecyclestage` (high-level lifecycle)
- `product_type` (contact type classification; used for additional director/member classification in the business, but reporting exclusion is driven by lead stage Not Applicable)

Important rule:
- Contact properties may be used for fallback attribution / enrichment.
- Lead pipeline stage is the reporting truth for lead progression metrics.

---

### 2.3 DEAL object (primary for revenue / pipeline truth)
We focus on SALES pipeline deals only.

Deal pipeline IDs (confirmed):
- Sales Pipeline: `723337811`
- Product Pipeline: `726643094` (excluded from reporting)

Closed Won definition (Sales pipeline):
- Deal stage ID: `1054943521` = Agreement Signed (Won) (Sales Pipeline)

Revenue:
- Deal `amount`

Units:
- Deal `total_no_of_sales`

Date logic:
- Sales truth totals are computed using **Close Date window** (last 90 days by close date).
- Revenue split:
  - New prospect revenue: where associated Contact create date is within 30 days of close date
  - Older/unknown prospect revenue: everything else

---

## 3) Attribution Model (Hierarchy)

When attributing leads/deals to campaigns, we use:

1) Nearest form submission UTMs (best quality)
2) Contact UTMs (fallback; matches HubSpot UI reality for FB leads)
3) Campaign asset membership / campaign fields (where available)
4) UNATTRIBUTED (still counted)

Important:
- If we cannot attribute, we still include the lead/deal in truth totals and mark it UNATTRIBUTED.

---

## 4) Consultant Filtering (Sales Performance)

Sales performance reporting should include ONLY records owned by the Consultants group.

If group membership isn’t available via API in our implementation, filter by these owner names:
- Jordan Sharpe
- Laura McCarthy
- Akash Bajaj
- Gareth Robertson
- David Gittings
- Spencer Dunn

Owner cache is used to map owner IDs → names.

---

## 5) Known Reporting Outputs We Expect

### 5.1 Executive summary (must include)
- Truth totals (90d close date window):
  - Total revenue won (amount)
  - Total deals won
  - Total units sold (total_no_of_sales)
  - Revenue split: new prospects (<=30d) vs older/unknown
- Attribution coverage:
  - Attributed revenue vs unattributed revenue
  - Attributed deals vs unattributed deals

### 5.2 Marketing performance
- Top campaigns by attributed revenue and pipeline
- Marketing Prospect count (leads not passed to sales)
- Lead quality: disqualification reasons (aggregate + by campaign where possible)

### 5.3 Sales performance
- Callable leads by consultant
- Stage progression counts/rates:
  - New → Attempting → Connected → Sales Qualified → Zoom Booked
- Disqualified counts + top reasons per consultant
- Outliers (best/worst rates)

---

## 6) HubSpot API Notes (Practical)

### 6.1 Batch limits
- HubSpot batch read endpoints often cap at 100 inputs per request.
- Any enrichment step must chunk inputs into batches of 100.

### 6.2 Common pitfalls we’ve already hit
- Missing scopes (e.g. `crm.objects.owners.read`)
- SSL/TLS required errors for Postgres (fixed via ssl config / connection params)
- Node ESM vs CJS issues (“Cannot use import statement outside a module”)

---

## 7) IDs & Constants (Quick Reference)

### Deal pipelines
- Sales: `723337811`
- Product: `726643094` (excluded)

### Closed Won stage (Sales)
- `1054943521`

### Lead stages
- Sales Qualified: `1213103916`
- Marketing Prospect: `1134678094` (marketing-only)
- Not Applicable (Additional Director/Member): `1109558437` (exclude)

## 2026-01-06 — Lifecycle Stage definitions (CONTACT.lifecyclestage)

These are CONTACT lifecycle stages (not the Lead pipeline stages).

- Subscriber (Subscriber): marketing subscription only (often missing phone / removed phone)
- Lead (Lead): expressed initial interest via ads/forms (typically email + phone)
- Marketing Qualified Lead (marketingqualifiedlead): marketing qualified, ready for sales
- Sales Qualified Lead (salesqualifiedlead): sales qualified, fits ICP/TAM, strong interest
- Opportunity (opportunity): associated with a deal (e.g., Zoom consultation scheduled)
- Customer (customer): signed client agreement; 7-day cooling off waived/expired
- Not Eligible (other): not a fit; documented disqualification reasons
- Withdrawn Customer (1050299822): withdrew after entering contract
- Cancelled Customer (1050058114): cancelled under 7-day clause
- Not Applicable (Additional Member/Director) (1109670527): lifecycle stage used for additional members/directors (distinct from Lead-stage Not Applicable used in lead pipeline reporting)

## Reporting note: Marketing Prospect vs MQL
- Marketing Prospect currently refers to Lead pipeline stage id 1134678094 (lead_facts_raw.lead_stage) and is a marketing metric only.
- MQL is CONTACT.lifecyclestage = marketingqualifiedlead and is a separate concept from Marketing Prospect.
To report both, we need CONTACT lifecycle stage data available in Postgres (or a reliable ingestion job).

## 2026-01-06 — Campaign funnel definitions (Lead-based cohort, 90d)

### Why Lead-based (not Contact lifecycle)
- Contact lifecycle stage (contacts.lifecyclestage) is mutable over time and is not currently ingested into Postgres (no contacts.lifecyclestage table/column present).
- For a stable, auditable weekly rolling 90-day view, we use the cohort of Leads created in the last 90 days (lead_facts_raw.created_at).

### Campaign key for funnel grouping
- Group by utm_campaign sourced from contact linkage:
  - contact_email_cache.utm_campaign (by contact_id)
  - lead_contact_map maps lead_id <-> contact_id
  - lead_facts_raw contains lead_stage for progression
- If utm_campaign is empty, bucket as UNATTRIBUTED.

### Funnel measures (all are counts)
Cohort: leads created in last 90 days.

- Leads Total:
  - Count of lead_facts_raw rows in window joined through lead_contact_map/contact_email_cache

- Non-MQL (Marketing Prospect):
  - lead_facts_raw.lead_stage = 1134678094 (Marketing Prospect / Prospect Qualification)
  - Business meaning: leads generated that are not eligible to pass to sales (e.g., form answers imply unqualified / not wanting a call)

- MQL-Eligible (lead-level eligibility):
  - MQL-Eligible = Leads Total - Non-MQL - Not Applicable
  - NOTE: includes leads even if later disqualified (disqualified is reported separately)

- Not Applicable (excluded):
  - lead_facts_raw.lead_stage = 1109558437 (Additional Director/Member auto-created leads)
  - Exclude from callable-leads reporting and from MQL-Eligible

- Disqualified (reported separately):
  - lead_facts_raw.lead_stage = unqualified-stage-id
  - Report separately; does not remove leads from MQL-Eligible eligibility count

- SQL:
  - lead_facts_raw.lead_stage = 1213103916 (Sales Qualified / Prospect Qualification)
  - Note: may be skipped if the lead goes straight to Zoom Booked

- Zoom Booked:
  - lead_facts_raw.lead_stage = qualified-stage-id (Zoom Booked / Prospect Qualification)

- Deals Won:
  - Derived from deal_revenue_rollup_90d by utm_campaign (counts of deals_won)

### Ranking used in report
- Top 3 / Bottom 3 campaigns ranked by Zoom Booked rate (zoom_booked / leads_total) for early sales signal.
- Tables show counts; rates may be mentioned but should be formatted as percentages.

## Campaign Funnel Reporting – Locked Definitions (2026-01)

### Lead Cohort
- Cohort = all leads created in the last 90 days.
- EXCLUDE ENTIRELY:
  - Lead stage "Not Applicable" (ID: 1109558437).
  - These are additional members/directors and must never be counted in performance reporting.

### Funnel Classification Rules
- Leads Total = all eligible leads created in window.
- Non-MQL = leads that ever entered "Marketing Prospect" stage (ID: 1134678094).
- MQL-Eligible = Leads Total − Non-MQL.
- SQL = leads that ever entered:
  - Sales Qualified stage (ID: 1213103916), OR
  - Zoom Booked stage (ID: qualified-stage-id).
- Zoom Booked = leads that ever entered Zoom Booked.
- Disqualified = leads that ever entered unqualified stage.
  - Disqualification does NOT exclude leads from MQL or SQL counts.

### Attribution Rules (Campaign Funnel)
- Campaign attribution is resolved via:
  1) Campaign on contact
  2) Most recent form submission UTMs
  3) Contact UTMs
  4) Otherwise UNATTRIBUTED
- UNATTRIBUTED is a tracking bucket, not a campaign.

### Purpose
- Campaign funnel tables are an EARLY-SIGNAL diagnostic.
- Revenue performance is reported separately using Sales truth totals.
