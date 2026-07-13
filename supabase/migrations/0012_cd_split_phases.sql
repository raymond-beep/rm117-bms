-- CD becomes two real phases (0012) — Angelena's review of the 0011 model.
--
-- 0011 modelled Prep/Outgoing as SUB-phases of cd_phase (a chip on the card). Ang works
-- the CD stage as two distinct piles she drags jobs between, so they need to be real
-- board sections: `cd_phase` is replaced by `cd_prep` + `cd_outgoing`.
--
-- Design KEEPS its sub-phases (dp1/dp2/dp3): how many a job has varies by proposal, so
-- they can't be a fixed set of board sections the way CD's two piles can.
--
-- Also: PERMITTING moves from the Pipeline tab to In-Construction, so the Pipeline ends
-- with the CD stage. That's a UI grouping (BOARD_TABS) — no schema change.
--
-- Mapping of the 5 existing CD jobs:
--   sub_phase='outgoing' (4) → cd_outgoing
--   sub_phase=null       (1) → cd_prep      (CDs started, not yet wrapping up)

-- 1. Widen the CHECK first so the new values are writable.
alter table jobs drop constraint if exists jobs_phase_check;
alter table jobs add constraint jobs_phase_check check (phase in (
  'lead','potential','survey_zoning','design_phase','cd_phase','cd_prep','cd_outgoing',
  'permitting','construction','on_hold','completed','job_dropped','canceled'
));

alter table field_notes drop constraint if exists field_notes_phase_check;
alter table field_notes add constraint field_notes_phase_check check (phase is null or phase in (
  'lead','potential','survey_zoning','design_phase','cd_phase','cd_prep','cd_outgoing',
  'permitting','construction','on_hold','completed','job_dropped','canceled'
));

-- The sub_phase CHECK referenced cd_phase — drop it before rewriting the rows.
alter table jobs drop constraint if exists jobs_sub_phase_check;

-- 2. Split the data.
update jobs set phase = 'cd_outgoing', sub_phase = null
  where phase = 'cd_phase' and sub_phase = 'outgoing';
update jobs set phase = 'cd_prep', sub_phase = null
  where phase = 'cd_phase';                       -- whatever's left (prep / unset)

update field_notes set phase = 'cd_prep' where phase = 'cd_phase';
update job_phase_events set phase = 'cd_prep' where phase = 'cd_phase';

-- 3. Retire cd_phase and re-tighten every constraint.
alter table jobs drop constraint if exists jobs_phase_check;
alter table jobs add constraint jobs_phase_check check (phase in (
  'lead','potential','survey_zoning','design_phase','cd_prep','cd_outgoing',
  'permitting','construction','on_hold','completed','job_dropped','canceled'
));

alter table field_notes drop constraint if exists field_notes_phase_check;
alter table field_notes add constraint field_notes_phase_check check (phase is null or phase in (
  'lead','potential','survey_zoning','design_phase','cd_prep','cd_outgoing',
  'permitting','construction','on_hold','completed','job_dropped','canceled'
));

-- Only Design has sub-phases now.
alter table jobs add constraint jobs_sub_phase_check check (
  sub_phase is null
  or (phase = 'design_phase' and sub_phase in ('dp1','dp2','dp3'))
);
