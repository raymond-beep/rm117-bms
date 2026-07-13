-- Job phase model, rebuilt to Angelena's actual workflow (0011).
--
-- Adds:  lead, permitting, construction, job_dropped
-- Drops: active            (it was really a CD sub-stage — "Outgoing")
-- Keeps: canceled          (a SIGNED job terminated early — distinct from job_dropped,
--                           where the proposal was rejected and work never began)
--
-- New lifecycle:
--   Lead → Proposal Sent → Survey/Zoning → Design → CD → Permitting → Construction → Completed
--   branches: Proposal Sent → Job Dropped;  any signed phase → Canceled / On Hold
--
-- SUB-PHASES — two phases are split to manage workload:
--   design_phase → dp1 / dp2 / dp3   (how many is set by the proposal → design_phase_count)
--   cd_phase     → prep / outgoing   (outgoing = 90% done, must wrap up)
--
-- The 4 jobs sitting in 'active' were really CDs in their wrap-up stage, so they become
-- cd_phase + sub_phase='outgoing'. That is the only data rewrite here.

-- 1. New columns -----------------------------------------------------------
alter table jobs add column if not exists sub_phase text;
alter table jobs add column if not exists design_phase_count integer;
-- When the job entered its current phase. Powers the aging flags (proposal > 14 days,
-- CDs > 21 days). Backfilled below from the phase-event log, falling back to updated_at.
alter table jobs add column if not exists phase_since timestamptz;

-- 2. Migrate the data BEFORE tightening the constraints --------------------
update jobs set sub_phase = 'outgoing', phase = 'cd_phase' where phase = 'active';
update field_notes set phase = 'cd_phase' where phase = 'active';

update jobs j
set phase_since = coalesce(
  (select max(e.entered_at) from job_phase_events e
    where e.job_id = j.job_id and e.phase = j.phase),
  j.updated_at,
  j.created_at
)
where j.phase_since is null;

-- 3. Swap the CHECK constraints -------------------------------------------
alter table jobs drop constraint if exists jobs_phase_check;
alter table jobs add constraint jobs_phase_check check (phase in (
  'lead','potential','survey_zoning','design_phase','cd_phase',
  'permitting','construction','on_hold','completed','job_dropped','canceled'
));

-- NB: field_notes.phase is nullable (a note can predate any phase) — keep that.
alter table field_notes drop constraint if exists field_notes_phase_check;
alter table field_notes add constraint field_notes_phase_check check (phase is null or phase in (
  'lead','potential','survey_zoning','design_phase','cd_phase',
  'permitting','construction','on_hold','completed','job_dropped','canceled'
));

-- A sub_phase must belong to its phase. Enforced in the DB as well as the API so a bad
-- pair (e.g. cd_phase + 'dp2') can never be written by any path.
alter table jobs drop constraint if exists jobs_sub_phase_check;
alter table jobs add constraint jobs_sub_phase_check check (
  sub_phase is null
  or (phase = 'design_phase' and sub_phase in ('dp1','dp2','dp3'))
  or (phase = 'cd_phase'     and sub_phase in ('prep','outgoing'))
);

alter table jobs drop constraint if exists jobs_design_phase_count_check;
alter table jobs add constraint jobs_design_phase_count_check check (
  design_phase_count is null or design_phase_count between 1 and 3
);
