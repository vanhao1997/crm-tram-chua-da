# Data integrity contract

## Data model

This deployment is one workspace with four allowlisted sources. Workspace identity
is derived from the configured spreadsheet IDs; clients cannot select another
workspace, spreadsheet, or range.

Sheets remain read-only, as requested by the operator. The app completes missing
appointment events only from explicitly confirmed leads with valid lead and
appointment dates. Existing appointment events and already represented leads
take precedence, including moved schedules. Derived events retain source-row
provenance and are labeled in the UI; no arrivals or payments are inferred.

Daily Marketing customer metrics are recalculated from the same fresh CRM
snapshot. Original Sheet discrepancies remain visible as corrected warnings.
An arrived row with missing revenue makes that day's revenue unavailable.
Persisted UUIDs require a future authorized source migration. Optional FS:FX
identity columns are read only when present; current sources do not have them.
Derived event fingerprints survive sorting but are not immutable record keys.

The overview is a server aggregate read model. A single `/api/overview` request
returns CRM counts, period financial totals, compact integrity/freshness metadata
and bounded appointment summaries. Appointment items contain only name, service,
appointment day/time, status and derived provenance. Phone numbers, notes, source
rows and record identities are excluded. CRM and Marketing use the same cached
atomic CRM snapshot; a source
failure leaves only that source's dependent aggregates unavailable.

Appointment summaries use the canonical booked source (including confirmed lead
events completed by the read-only service). The past-appointment KPI counts
booked events in the selected period whose scheduled time has elapsed; this is
not a no-show count. Recent past appointments cover today and the preceding six
Vietnam calendar days, independently of the financial filter. Upcoming events
include future dates and today before a confirmed time has elapsed. Missing or
ambiguous times remain upcoming today and become past on the next calendar day.
Canceled, rescheduled and completed events are excluded only from upcoming;
recent past events retain their recorded status. Matching a visit requires an
appointment ID, or the same normalized valid phone and exact visit day; an older
visit never marks a newer appointment completed. Each list returns the nearest
20 records, its full count and omitted count. The UI refreshes every five minutes
using the existing 60-second source cache and 15-minute stale limit.

Sources use numeric Google sheet IDs, resolving their current titles before a
read. Renaming a tab therefore does not change its source identity. Sheet names
are a fallback only for custom installations without configured numeric IDs.

## Metric dictionary

All calendar boundaries use Asia/Ho_Chi_Minh, equivalent to Asia/Saigon.

| Metric | Source | Formula | Grain / date |
| --- | --- | --- | --- |
| Leads | CRM leads | Count populated customer rows | Lead event, column B |
| Appointments | CRM booked + confirmed leads | Count original and missing confirmed events once | Appointment event, column K |
| Arrivals | CRM arrived | Count populated visit rows | Visit event, K, B only if K missing |
| Revenue | CRM arrived / marketing | Sum recorded revenue | Visit day, W then legacy V |
| Ads | Marketing daily | Sum D | Calendar day A |
| Management fee | Marketing daily | Sum E | Calendar day A |
| Total cost | Marketing daily | D + E when both recorded; otherwise F with validation | Calendar day A |
| Received | Marketing daily | Sum C in selected period | Calendar day A |
| Received minus cost | Marketing daily | Received - total cost | Selected period; not wallet balance |
| Cost / revenue | Marketing daily | (Ads + management fee) / Revenue, displayed as % | Matching selected days through today in Asia/Ho_Chi_Minh; source refresh every 5 minutes; unavailable if revenue <= 0 or either total is missing. Red above 30%, green at or below 30%, using the unrounded ratio. |
| CPL / cost per arrival | Marketing daily | Total cost / corresponding count | Matching days; unavailable if denominator zero |

Monthly totals include daily records once and never include another subtotal.
The reporting UI may include future scheduled appointments in a monthly window;
marketing actuals exclude future calendar days. Deterministic budget analysis
uses the existing D-2 closing convention and requires valid, fresh source data.
Event ratios are not acquisition-cohort conversion rates.

The overview counts scheduled appointments across the entire selected window,
including future dates. Lead, arrival, revenue and Marketing financial actuals
stop at today's Vietnam calendar day. A blank daily deposit means no deposit;
missing numeric costs or revenue leave their total unavailable. Duplicate daily
Marketing dates invalidate financial aggregates instead of double counting.
Source warnings are grouped by code and restricted to the selected window.

## Delivery phases

MVP restores current-month sources, app calculations, appointment consistency,
and period financial values. V1 aligns date rules, legacy revenue, subtotal
boundaries, source freshness and explicit unavailable states. Tab IDs and
automatic read-only reconciliation on refresh and every five minutes are also
implemented. Future retains persisted record keys and source formula repairs;
both require write access and are excluded from this read-only release.

The overview-only MVP removes browser charts, detail tables, customer actions,
historical comparisons and budget analysis. V1 transfers calculations to one
compact aggregate endpoint and caches fingerprinted static assets, while HTML
and source data remain revalidated. Future source migrations remain deferred.

## Acceptance

- CRM sources share a complete, fresh snapshot and numeric tab identities.
- Source and marketing counts reconcile by day and service.
- Appointments with a previous-month lead date are counted in their event month.
- Revenue follows visit date consistently; legacy numeric V values are preserved.
- Received/cost totals use the selected period and reconcile within one VND.
- A failed source cannot become a trusted zero or actionable budget decision.
- Old snapshots expire; health reports source freshness separately from liveness.
- Numeric source identities survive tab renaming; clients cannot select foreign sources.
- AI provider code, routes, credentials and browser calls are removed.
- Overview pages request aggregate data and bounded appointment cards, with no Chart.js or full customer-detail rendering.
- Recent appointment windows and time classification use Vietnam calendar days; past does not mean no-show.
- Appointment cards preserve source status, escape text and omit phones and private notes.
- Overview totals match event dates and daily finance independently of the browser timezone.
- Missing/stale source status remains visible after overview simplification.

## Operational risks

Public access and existing Sheet permissions are retained at the operator's
request. Customer-data exposure remains an access-control risk.
This is a single-workspace app, not a multi-tenant authorization system.
Source freshness is not proof that every real-world visit has been entered.
Received minus cost is not an invoice, payment settlement or Ads wallet balance.
June 24 and June 27 include visits with missing recorded revenue; the app reports
these gaps rather than inventing amounts. With current-month Ads spending and no
visit recorded in that month, budget recommendations remain blocked until data
entry is confirmed by actual source records. Native Sheet formulas are unchanged.
