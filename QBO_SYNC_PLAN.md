# QuickBooks → App payment sync (scheduled reconciliation)

**Status:** Step 1 (schema) + dry-run endpoint being built. Cron schedule NOT yet enabled.

## Why
Payments enter the app's `payments` table today **only** via the Zapier "invoice paid"
webhook (`api/payments/webhook.js`). That's event-driven and fragile: if the Job ID doesn't
match the QBO Customer Display Name at the instant a payment posts, the webhook 404s and the
payment is silently lost (this is what happened to `25_054_Malanga_Subdivide` — two paid
invoices, $6,000, never recorded, found only by manual reconciliation on 2026-07-08).

This adds a **scheduled sync** that pulls all QBO payments and reconciles them into the app,
so every job stays in step with QuickBooks automatically — self-healing after Job ID renames,
and auto-back-filling misses firm-wide.

## Ray's decisions (2026-07-08)
1. **Frequency:** start **hourly**.
2. **Keep both paths:** the Zapier webhook stays as the instant path; the cron is the
   completeness backstop (safety net). Revisit retiring Zapier once the cron is trusted.
3. **payment_type:** **infer** it from the linked invoice's line text, but allow a manual
   revision that the sync won't clobber (see `payment_type_locked`).

## Data source: the QBO **Payment** entity (not invoices)
The real "money received" record is the `Payment` object, distinct from the `Invoice`. It
carries the actual **payment date** (`TxnDate`), `CustomerRef.name` (= Job ID, via the
invariant), `TotalAmt`, and `Line[].LinkedTxn` (the invoice(s) it paid). We sync at Payment
grain, which handles partial payments and multiple-payments-per-invoice naturally.

One paginated `Payment` query per run (helper `listPaymentsUpdatedSince` in `api/_lib/qbo.js`),
**not** one call per job — cheap, well within QBO rate limits.

## Schema (migration `0009_qbo_payment_sync.sql`) — DONE in step 1
- `payments.qbo_payment_id text` (nullable) — the **canonical dedup key** going forward.
  Partial unique index `where qbo_payment_id is not null`.
- `payments.payment_type_locked boolean default false` — set when a human revises the type so
  the sync leaves it alone.
- `sync_state` singleton table — `{ id, watermark, last_run_at, last_summary }`, mirrors the
  `qbo_tokens` singleton pattern. `watermark` = last processed `MetaData.LastUpdatedTime`.

### The dedup gotcha (why `qbo_payment_id`)
Existing rows (Zapier webhook + the Malanga back-fill) are keyed on the **invoice** id
(`qbo_invoice_id`). Payments are their own objects with their own ids. Keying the sync on
`Payment.Id` while old rows are keyed on invoice id would double-count. So the sync's first pass
**adopts** legacy rows instead of duplicating:
- Row already has this `qbo_payment_id` → **update**.
- Else a `payment_method='qb'` row with a matching `qbo_invoice_id` and no `qbo_payment_id` →
  **adopt** (stamp the payment id, correct date/amount/type).
- Else → **insert**.

The Malanga back-fill deliberately used the invoice **internal** ids (1585/2434), which equal
`Payment.Line[].LinkedTxn.TxnId`, so those adopt cleanly. **Watch:** any older Zapier rows that
stored the invoice **DocNumber** (1182/1301) instead won't adopt and would show as `insert` —
the **dry run exists to catch exactly this** before anything writes.

## Safety invariant (most important rule)
The sync **only ever touches rows where `payment_method = 'qb'`**. Manual cash/check/venmo/zelle
entries are never read, updated, or deleted. QuickBooks is truth **for QBO payments only** —
never a blanket overwrite.

## The endpoint: `api/cron/qbo-sync.js` (GET)
Auth: Vercel Cron's `Authorization: Bearer $CRON_SECRET` **or** a staff session (for manual
dry-runs from the browser / local dev). **Defaults to dry-run** (`?dry=0` to actually write)
while the schedule is off — safe by construction.

Per run:
1. Read `sync_state.watermark` (unless `?full=1` → sweep all history).
2. `listPaymentsUpdatedSince(watermark)`.
3. Preload the set of valid `job_id`s + fetch the linked invoices once (for type inference).
4. Per payment: resolve `job_id = CustomerRef.name`; if no matching job → **skip + log as
   unmatched** (this list *is* the continuous firm-wide reconciliation). Else adopt-or-upsert
   per the dedup rules; infer `payment_type` (respecting `payment_type_locked`); `payment_method='qb'`.
5. (live only) advance the watermark; write `last_run_at` + `last_summary`.
6. Return `{ scanned, insert, adopt, update, unchanged, unmatched:[...] }`.

## Scheduling (later — step 5, not yet enabled)
`vercel.json` `crons: [{ path: "/api/cron/qbo-sync?dry=0", schedule: "0 * * * *" }]` (hourly),
gated on `CRON_SECRET`. Register the route in `server.js` for local dev.

## Rollout
1. ✅ Migration `0009` (additive, reversible). — **this step**
2. ✅ `api/cron/qbo-sync.js` dry-run + QBO helpers + shared `normalizePaymentType`. — **this step**
3. ⬜ Manual full dry-run (`?full=1`) → review `unmatched` + `insert` list → fix any Job-ID/
   customer-name mismatches. (This subsumes the paused one-off firm-wide reconciliation.)
4. ⬜ Add a PATCH on `/api/payments` + a small UI to revise `payment_type` (sets the lock).
5. ⬜ Enable the hourly cron (flip to live writes).

## Open follow-ups
- **Voids/deletes in QBO** (a reversed payment) need QBO Change Data Capture (CDC) to detect a
  deletion; `MetaData.LastUpdatedTime` catches edits but not hard deletes. Deferred to v1.1.
- Consider retiring Zapier once the cron is trusted (decision 2 says keep both for now).
