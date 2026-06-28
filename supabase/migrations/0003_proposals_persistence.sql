-- Proposal persistence (fields-only): save/reopen proposals from the generator.
-- The full form state lives in the existing `proposals.content` jsonb; no files
-- are stored (attachments are re-added on reopen; the PDF regenerates on demand).
--
-- A proposal can be drafted before its job exists (it's how the work is won), so
-- job_id is optional. updated_at powers "most recently edited" ordering.
alter table public.proposals alter column job_id drop not null;
alter table public.proposals add column if not exists updated_at timestamptz not null default now();
