-- 0017 — Set Check (DRAFT — NOT YET APPLIED). Review before running.
--
-- Set Check is the sibling of Drawing QA: pick a job, pick the documents from its
-- Drive folder, and check what a contractor SUBMITTED / BOUGHT against what we
-- SPECIFIED. Windows are the first case — a submitted vendor brochure is checked on
-- two attributes only:
--   • size    vs the job's window schedule
--   • u_factor vs the value the job's REScheck is based on
-- Everything else about the window (series / grille / color / operation) is the
-- developer's choice and is never checked. The same two tables carry exterior doors,
-- fire-rated doors, and scheduled fixtures later (item_type + attribute widen).
--
-- Mirrors the drawing_sets pattern: a "run" points at Drive documents (the bytes are
-- streamed on demand, never copied into Postgres); findings are the per-item results
-- a person confirms. Nothing here is authoritative until a staffer confirms it.

-- One check run = one (job, item type, submitted document) a reviewer opened.
create table if not exists set_check_runs (
  id                uuid primary key default gen_random_uuid(),
  job_number        text not null,                       -- e.g. 24_073_DaSilva
  item_type         text not null default 'window'
                      check (item_type in ('window','ext_door','fire_door','fixture')),
  -- Drive file ids for the three inputs (nullable until picked). Streamed on demand
  -- like checksets — the PDFs are not stored in this database.
  schedule_file_id  text,                                -- our schedule (sizes per tag)
  rescheck_file_id  text,                                -- our REScheck (required U-factor)
  submittal_file_id text,                                -- contractor's brochure / cut sheet
  status            text not null default 'open'
                      check (status in ('open','analyzed','confirmed')),
  created_by        text not null,                       -- Clerk user id (staff)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table set_check_runs is
  'One Set Check run: a job + item type + the Drive documents to compare. Sibling of drawing_sets.';

-- One finding per checked item/attribute (e.g. window tag "A", attribute "u_factor").
create table if not exists set_check_findings (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references set_check_runs(id) on delete cascade,
  item_label    text,                                    -- schedule tag / opening, e.g. "A" or "TW2842"
  attribute     text not null
                  check (attribute in ('size','u_factor','rating')),
  specified     text,                                    -- what OUR document says
  submitted     text,                                    -- what the brochure says
  verdict       text not null default 'flag'
                  check (verdict in ('pass','flag')),
  -- A person confirms every finding; nothing is authoritative until confirmed.
  confirmed_by  text,
  confirmed_at  timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);

comment on table set_check_findings is
  'Per-item, per-attribute result of a Set Check run (pass / flag), confirmed by a staffer.';

create index if not exists set_check_runs_job_idx     on set_check_runs (job_number);
create index if not exists set_check_findings_run_idx on set_check_findings (run_id);
