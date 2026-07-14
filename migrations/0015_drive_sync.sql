-- 0015 — Drive → app sync (the other direction).
--
-- The app already pushes to Drive (a signed job gets its folder tree). But the firm
-- works both ways round: Ray, Angelena and Tom often create the Drive folder FIRST —
-- sometimes weeks before anything reaches the app. Those jobs were invisible here
-- (24_005_Dunn_Nosker had to be found by hand during the QBO reconciliation).
--
-- Drive already speaks the app's language, by accident: a folder named `26_XXX_Onorato`
-- is exactly the app's lead placeholder (`26_xxx_Onorato`), and `26_044_Seesman` is a
-- numbered job. So the sync is a diff, not a translation.
--
-- ⚠️ THE WATERMARK IS THE WHOLE DESIGN. A full scan finds 255 job folders + 104 lead
-- folders against the app's 134 jobs — a 233-folder gap, but nearly all of it is HISTORY
-- (dead 2023/24 work; the app was seeded from Ang's Sheet, which only held live jobs).
-- Importing that would bury the board. So we record a start line at install time and the
-- queue only ever offers folders CREATED AFTER IT. The backlog is deliberately unreachable
-- from the queue — see the Drive-backlog note in NEXT_SESSION.md before "fixing" that.

-- Where a job's Drive project folder actually is. Previously only the "Files Sent"
-- subfolder was stored, and everything else re-found the folder BY NAME each time.
-- An imported job needs the id itself: a lead imported from Drive ALREADY has a folder,
-- so promoting it must RENAME that folder, not provision a second one beside it
-- (api/_lib/job-number.js). Name-matching can't do that — a lead's folder is named
-- `26_XXX_…` while its job_id is `26_xxx_…`.
alter table jobs add column if not exists drive_folder_id text;

comment on column jobs.drive_folder_id is
  'Google Drive project-folder id. Set when a job is imported FROM Drive, or provisioned by the app. Promotion renames this folder rather than creating a new one.';

-- Singleton: the start line. Rows created at or before this are backlog, not new work.
create table if not exists drive_sync (
  id smallint primary key default 1 check (id = 1),
  watermark timestamptz not null default now(),
  last_scan_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table drive_sync is
  'Singleton. `watermark` = the Drive-sync start line: only folders created after it reach the review queue, so the 233 historical folders never flood the board.';

-- The start line: 1 Jan 2026 (Ray, 2026-07-14). NOT now() — the current year's work is
-- exactly what's missing. At this line the queue offers 28 folders: 5 numbered jobs
-- (26_044_Seesman was on that week's planner and wasn't in the app at all) and 23 live
-- leads, against a Job Leads tab showing 2. Everything older — the 2023/24 dead work the
-- app was never seeded with — stays out.
insert into drive_sync (id, watermark) values (1, '2026-01-01T00:00:00Z')
on conflict (id) do nothing;

-- Folders a staffer has explicitly waved off, so the queue doesn't nag forever.
-- Keyed by Drive folder id (a rename must not resurrect a dismissed folder).
create table if not exists drive_sync_dismissed (
  drive_folder_id text primary key,
  folder_name text,
  dismissed_by text,
  dismissed_at timestamptz not null default now()
);

comment on table drive_sync_dismissed is
  'Drive folders a staffer chose not to import (a reference folder, a mistake, a duplicate). Keyed by folder id, not name, so renaming one does not resurrect it in the queue.';
