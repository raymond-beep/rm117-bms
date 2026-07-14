-- 0016 — Fire Escape is its own work type (Ray, 2026-07-14).
--
-- The Job ID has always encoded it — `26_046_FE_Belleville`, `25_053_FE_Mendham` — exactly
-- the way `FF_` encodes Forefront. But the app only ever modelled FF, and read FE as an
-- ordinary part of the name. So a Fire Escape job was indistinguishable from a plain
-- residential one, and the only reason none of them got mis-tagged as Forefront is that
-- the FF check is an exact `_FF_` match.
--
-- ⚠️ FE IS NOT FOREFRONT AND NOT A DEVELOPER — it is a third, separate thing. Do not
-- collapse it into is_forefront, and do not treat the two markers as interchangeable:
-- Forefront carries a commission (ff_commission / ff_commission_paid); Fire Escape does not.
alter table jobs add column if not exists is_fire_escape boolean not null default false;

comment on column jobs.is_fire_escape is
  'Fire Escape job (the _FE_ marker in the Job ID). A distinct work type — NOT Forefront (is_forefront) and not a developer. Mutually exclusive with is_forefront in practice.';

-- Backfill from the Job ID, which is the source of truth for the marker.
-- (5 jobs at write time: 25_007_FE_Sebastian, 25_011_FE_Summit, 25_032_FE_Hickson,
-- 25_053_FE_Mendham, 26_040_FE_Philly — none of them was wrongly flagged Forefront.)
update jobs set is_fire_escape = true
where job_id ilike '%\_FE\_%' and not is_fire_escape;
