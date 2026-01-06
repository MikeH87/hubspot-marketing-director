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

