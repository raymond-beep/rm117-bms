-- QuickBooks payment sync: canonical dedup key + scheduled-sync state.
--
-- Payments enter the app today only via the Zapier "invoice paid" webhook, which
-- 404s (and silently drops the payment) when a Job ID doesn't match the QBO
-- Customer Display Name at the instant it posts. The scheduled sync
-- (api/cron/qbo-sync.js) pulls ALL QBO payments and reconciles them, so every job
-- stays in step with QuickBooks. See QBO_SYNC_PLAN.md.
--
-- The sync keys on the QBO *Payment* object (the money-received record), which is
-- distinct from the invoice. Existing payment rows (Zapier webhook + the Malanga
-- back-fill) are keyed on the invoice id (qbo_invoice_id); to avoid double-counting,
-- the sync ADOPTS those rows (stamping qbo_payment_id) rather than inserting new
-- ones. Hence a dedicated, uniquely-indexed payment-id column.

-- Canonical dedup key for the sync (the QBO Payment.Id). Nullable: manual and
-- legacy rows won't have it until adopted.
alter table public.payments add column if not exists qbo_payment_id text;

-- Unique per QBO payment, but only when set (manual/legacy rows stay unconstrained).
create unique index if not exists payments_qbo_payment_id_key
  on public.payments (qbo_payment_id)
  where qbo_payment_id is not null;

-- Set true when a human revises the inferred payment_type; the sync then leaves
-- that row's type alone (amount/date still reconcile from QBO).
alter table public.payments add column if not exists payment_type_locked boolean not null default false;

-- Singleton state for the scheduled sync (mirrors the qbo_tokens pattern).
-- watermark = the last MetaData.LastUpdatedTime processed (incremental cursor);
-- last_summary = the most recent run's {scanned, insert, adopt, update, unmatched}.
create table if not exists public.sync_state (
  id           text primary key,
  watermark    timestamptz,
  last_run_at  timestamptz,
  last_summary jsonb,
  updated_at   timestamptz not null default now()
);
