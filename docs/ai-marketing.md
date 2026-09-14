# AI Marketing History Analysis

The Marketing page sends an anonymous aggregate snapshot to `POST /api/marketing/ai-analysis` after the operator clicks **Phân tích kỳ này**. The browser never receives or stores `AI_API_KEY`, and the API does not send names, phone numbers, raw rows, Sheet IDs, or credentials to the provider.

## What the analysis uses

- Current metrics for the active phase (early, mid, or late month), limited by the selected date range and D-2 cutoff.
- Historical windows with the same day offsets in up to 12 earlier months. Each window includes `monthKey`, `startDate`, `endDate`, completeness, and ROAS/funnel metrics.
- CRM event counts grouped by source date. CRM revenue remains separate from Marketing revenue; it is never added to Marketing totals.
- Data quality issues, stale status, excluded days, invalid rows, and the deterministic budget guardrail.

Historical samples require three complete, valid matched windows before an actionable AI recommendation is allowed. Missing values remain `null`; they are not treated as zero.

## Metric contract

| Metric | Source and formula | Grain / timezone | Sync |
| --- | --- | --- | --- |
| ROAS | Marketing `revenue / marketing_cost` | Selected phase, daily rows aggregated in `Asia/Ho_Chi_Minh` | On refresh, normally every 5 minutes |
| Cost per arrived | Marketing `cost / arrivedTotal` | Selected phase, daily rows aggregated in `Asia/Ho_Chi_Minh` | On refresh |
| Booking and arrival rate | `bookedTotal / dataTotal` and `arrivedTotal / bookedTotal` | Selected phase, daily rows aggregated in `Asia/Ho_Chi_Minh` | On refresh |
| CRM counts | Event rows grouped by source date; no attribution claim | Selected window, event grain | On refresh |

The server uses the D-2 cutoff for the active period. A stale snapshot, critical warning, or fewer than three historical windows forces `insufficient_data`.

## Enable in deployment

Set these server variables in Coolify or the local API environment:

```text
AI_ENABLED=true
AI_BASE_URL=https://9router.vibecodingsolution.ovh/v1
AI_API_KEY=<secret>
AI_MODEL=cx/gpt-5.6-sol
AI_TIMEOUT_MS=20000
```

Restart the API after changing variables. If AI is unavailable or disabled, the deterministic budget model stays visible and no budget changes are automated.

## Delivery phases

- **MVP:** Read-only aggregate history analysis, schema validation, PII rejection, D-2 cutoff, stale-data guard, and deterministic fallback.
- **V1:** Operator-visible evidence, matched historical windows, CRM source separation, concrete next steps, and JSON export of the budget model.
- **Future:** Provider usage budgets, model quality evaluation, scheduled reports, and role-based approval workflows.

## Acceptance checks

1. Select a month and phase, then confirm the AI payload shows current dates and matched historical windows.
2. Confirm fewer than three valid historical windows returns `insufficient_data` and no spending adjustment.
3. Turn off `AI_ENABLED` or make the provider unavailable; confirm the formula-based decision and verification steps remain visible.
4. Run `npm test` and `npm run build` before deployment.
