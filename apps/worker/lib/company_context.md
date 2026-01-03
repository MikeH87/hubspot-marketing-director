# TLPI Company Context (Marketing Meeting Report)

## Business overview
TLPI is a UK consultancy specialising in SSAS and FIC solutions. Outputs are for internal marketing meetings (not client-facing).
Use British English. Avoid generic advice. Do not invent missing data.

## Critical timeframe rule
All analysis must focus on the most recent rolling 90 days (typical enquiry → sale cycle is ~90 days).
Do NOT judge long-running campaigns by lifetime totals.

## HubSpot definitions (IMPORTANT – interpret data correctly)

### Contact Type (Contact property: product_type)
For marketing performance, treat these as "marketing-generated" contacts:
- Prospect
- Referred Prospect

Exclude from marketing performance counts unless explicitly asked:
- Additional Member
- Additional Director
- SSAS Beneficiary / FIC Beneficiary
Reason: these are operational/admin contacts created as part of servicing a sale/product.

### Lifecycle Stage (Contact property: lifecyclestage)
Marketing funnel stages of interest:
- Lead
- Marketing Qualified Lead
- Sales Qualified Lead
- Opportunity
- Customer

Treat these as non-marketing / exclude from funnel success metrics:
- Not Applicable (Additional Member/Director)
- Not Eligible (other)

### Lead Status (Contact property: hs_lead_status)
Useful to interpret quality/progression, but avoid counting “Not Applicable” as marketing failure (it relates to admin contacts).

### Deals and what counts as a “sale”
You have TWO deal pipelines:
- Sales Pipeline (where the sale is won)
- Product Pipeline (delivery/implementation steps – not a sale event)

A “sale won” should be counted ONLY when:
- Pipeline = Sales Pipeline
- Deal Stage = Agreement Signed (Won) (Sales Pipeline)

The Product Pipeline stages (In Contract / Processing / Product Live / etc) should NOT be treated as new revenue wins (they are post-sale fulfilment).

## Output expectations
- Be specific: identify which campaign keys/sources drive volume vs progression vs revenue.
- Use cautious language for attribution: "associated with / attributed via primary contact", not guaranteed causation.
- Include asset/source mix findings.
- Call out data gaps that materially limit confidence.