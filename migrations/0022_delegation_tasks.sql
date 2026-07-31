-- 0022 — Weekly Planner: checkable TASKS replace ink + free-text notes.
--
-- Why: the pen was Angelena's request and she never used it — `delegation_strokes`
-- holds **2 rows** in the board's whole life. What she actually uses is the typed
-- notes (31 rows, every one authored by her), and she was already writing them as
-- lists, one item per line:
--
--     Tom, Dani, Cris - In Office
--     9:30am - Brubaker Walkthrough
--     Dunn Parlin Check Set
--     Williams Check Set
--
-- So the board becomes what it was being used as: a per-person, per-day checklist
-- you can tick off. Ray's call 2026-07-31.
--
-- ⚠️ `delegation_strokes` and `delegation_notes` are NOT dropped. Notes are the
-- source this backfills from, so keeping them makes the conversion reversible
-- (delete the tasks, the notes are still there); strokes stay as a 2-row tombstone.
-- Same rule the retired portal chat follows.

create table if not exists delegation_tasks (
  id                uuid primary key default gen_random_uuid(),
  week_key          text not null,                -- the Monday, YYYY-MM-DD
  row_owner_email   text not null,                -- a member's clerk_email, or '__studio__'
  day_index         integer not null check (day_index between 0 and 4),  -- Mon..Fri

  text              text not null,
  done              boolean not null default false,
  -- Who ticked it and when. Kept because "did anyone actually do this" is the
  -- question the board exists to answer, and a bare boolean cannot say when.
  done_at           timestamptz,
  done_by_email     text,

  -- Manual order within the cell. Ang writes a day's list top to bottom and the
  -- order carries meaning (an 11:00 measure comes after a 9:30 walkthrough), so
  -- this is not sorted by created_at.
  position          integer not null default 0,

  created_by_email  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists delegation_tasks_week_idx
  on delegation_tasks (week_key);
create index if not exists delegation_tasks_cell_idx
  on delegation_tasks (week_key, row_owner_email, day_index, position);

-- ── Backfill: every non-empty LINE of an existing note becomes one task ────────
--
-- Guarded so re-running this migration cannot duplicate the board. Positions are
-- 0-based per note, preserving the order she typed them in. Nothing is marked
-- done — a line she wrote is a thing to do, not a thing finished.
insert into delegation_tasks
  (week_key, row_owner_email, day_index, text, position, created_by_email, created_at, updated_at)
select
  n.week_key,
  n.row_owner_email,
  n.day_index,
  btrim(line.txt),
  (line.ord - 1)::int,
  n.created_by_email,
  n.updated_at,
  n.updated_at
from delegation_notes n
cross join lateral unnest(string_to_array(n.text, E'\n')) with ordinality as line(txt, ord)
where btrim(line.txt) <> ''
  and not exists (select 1 from delegation_tasks);
