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

