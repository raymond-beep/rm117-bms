-- Saved building-department letters (fields-only), mirroring proposals.
-- The editable form state lives in `content` jsonb; no files are stored
-- (attachments re-added on reopen, the PDF regenerates). job_id is optional.
create table if not exists public.letters (
  id uuid primary key default gen_random_uuid(),
  job_id text references public.jobs(job_id),
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.letters enable row level security;
-- RLS on, no policies: the service-role key (server-side api/letters.js) bypasses
-- RLS; no client ever queries this table directly (same posture as proposals).
