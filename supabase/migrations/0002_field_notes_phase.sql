-- Phase 5 — Field Notes → site-visit system of record.
-- Tag each field note with the job phase it was captured in, so the site report
-- can group notes by phase. Auto-stamped from the job's current phase at save
-- (editable); nullable so pre-existing notes and local-dev rows stay valid.
--
-- (The field_notes table itself was created directly in Supabase, not via an
-- earlier repo migration; this file records the Phase 5 schema delta.)
alter table public.field_notes
  add column if not exists phase text
    check (phase is null or phase in
      ('potential','survey_zoning','design_phase','cd_phase','active','on_hold','completed'));

comment on column public.field_notes.phase is
  'Job phase this note was captured in (auto-stamped from the job''s current phase at save; editable). Groups notes in the site report (Phase 5).';

-- Note: the reverse-geocoded street address is stored inside the existing
-- `location` jsonb as {lat, lng, address} — no column change needed.
