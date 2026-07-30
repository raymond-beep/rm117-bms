-- 0020 — Correspondence: email threads FILED against a job.
--
-- Why this exists: the firm's client communication lives entirely in Gmail. The
-- two in-app alternatives built earlier have zero rows — `threads`/`messages`
-- (the portal chat) never carried a single message, because it emailed nobody in
-- either direction, and `notifications` is empty too. So rather than add a third
-- place to talk to a client, this makes the REAL email filable against the job.
--
-- Filing is deliberate and staff-driven. Nothing here is populated by a sync:
-- a folder name, a subject line and a sender are not enough to decide a thread
-- belongs to a job, and a wrong link is worse than no link — the same rule the
-- Drive → app sync already runs on.
--
-- The staffer's mailbox stays the source of truth for MAIL. This table is the
-- record of what the FIRM decided belongs to a job, plus a copy of the text so a
-- colleague can read it without access to that person's inbox (which is the whole
-- reason "who can see this" was a problem worth solving).

create table if not exists mail_threads (
  id                uuid primary key default gen_random_uuid(),
  gmail_thread_id   text not null unique,
  subject           text,
  client_id         uuid references clients(id) on delete set null,
  last_message_at   timestamptz,
  message_count     integer not null default 0,

  -- ⚠️ Client visibility is OPT-IN, per thread, and defaults to FALSE.
  -- Filing a thread is an internal act; sharing it with the client is a separate
  -- decision a person makes. This mirrors the rule the portal already runs on —
  -- staff press the button, nothing reaches a client automatically.
  visible_to_client boolean not null default false,
  shared_at         timestamptz,
  shared_by         text,

  filed_by          text,
  filed_at          timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

-- A thread can belong to SEVERAL jobs. This is the whole reason correspondence
-- is not a column on `jobs`: the firm's biggest clients are developers, and one
-- email routinely covers three of their projects at once. Forcing a single job
-- would make staff pick a winner and lose the others.
create table if not exists mail_thread_jobs (
  thread_id  uuid not null references mail_threads(id) on delete cascade,
  -- ON UPDATE CASCADE so the "Correct Job ID" tool can rename a job without
  -- orphaning its correspondence (migration 0007's rule for every jobs FK).
  job_id     text not null references jobs(job_id) on update cascade on delete cascade,
  added_by   text,
  added_at   timestamptz not null default now(),
  primary key (thread_id, job_id)
);

create table if not exists mail_messages (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references mail_threads(id) on delete cascade,
  gmail_message_id  text not null,
  from_name         text,
  from_email        text,

  -- Every address on the message (from + to + cc), lowercased. This is what the
  -- client-facing view filters on: a client sees ONLY messages their own contact
  -- address was actually on, so internal replies inside a shared thread stay
  -- invisible to them. Storing it denormalised keeps that check a simple
  -- containment test rather than a parse at read time.
  participants      text[] not null default '{}',

  sent_at           timestamptz,
  body_text         text,
  body_html         text,
  has_attachments   boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (thread_id, gmail_message_id)
);

-- Attachment FILES are not copied here — they go to the job's Drive "Files
-- Received" folder, which is where the firm already keeps what clients send.
-- This is only the manifest plus the Drive id, so nothing is duplicated and
-- nothing is orphaned if a file is later moved in Drive.
create table if not exists mail_attachments (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references mail_messages(id) on delete cascade,
  filename       text not null,
  mime_type      text,
  size_bytes     bigint,
  drive_file_id  text,
  drive_folder   text,
  saved_at       timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists mail_thread_jobs_job_idx      on mail_thread_jobs (job_id);
create index if not exists mail_threads_client_idx       on mail_threads (client_id);
create index if not exists mail_threads_last_msg_idx     on mail_threads (last_message_at desc);
create index if not exists mail_messages_thread_idx      on mail_messages (thread_id, sent_at);
create index if not exists mail_messages_participants_ix on mail_messages using gin (participants);
create index if not exists mail_attachments_message_idx  on mail_attachments (message_id);
