-- Add 'canceled' as a terminal job phase.
-- A job terminated early (client canceled while the contract allowed it) is neither
-- On Hold (won't resume) nor Completed (work wasn't finished). 'canceled' is a distinct
-- terminal state kept only as a historical record. It sits outside the working pipeline
-- and outside the linear progress ladder (see src/lib/format.js).
--
-- Both the jobs.phase and field_notes.phase CHECK constraints enumerate the phase set,
-- so both must allow the new value (field_notes.phase is auto-stamped from the job's
-- current phase at save). The inline unnamed checks from 0001/0002 get Postgres's
-- default names jobs_phase_check / field_notes_phase_check.

alter table public.jobs drop constraint if exists jobs_phase_check;
alter table public.jobs add constraint jobs_phase_check
  check (phase in ('potential','survey_zoning','design_phase','cd_phase','active','on_hold','completed','canceled'));

alter table public.field_notes drop constraint if exists field_notes_phase_check;
alter table public.field_notes add constraint field_notes_phase_check
  check (phase is null or phase in ('potential','survey_zoning','design_phase','cd_phase','active','on_hold','completed','canceled'));
