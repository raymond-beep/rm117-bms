-- RM117 BMS — Phase 1 schema (see SCHEMA.md, the source of truth for table shape).
-- Run in the Supabase SQL editor (or `supabase db push`) once the project exists.
-- Conventions: uuid PKs (jobs uses the human-readable Job ID), money numeric(12,2),
-- timestamptz default now(), enums as check constraints, `outstanding` NEVER stored.

-- ============================================================
-- Identity tables
-- ============================================================

create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          text not null check (type in ('investor','contractor','homeowner','other')),
  email         text,
  phone         text,
  company       text,
  clerk_user_id text,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  clerk_user_id text,
  name          text not null,
  email         text not null,
  role          text not null check (role in ('admin','staff')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- Core tables
-- ============================================================

create table if not exists jobs (
  job_id              text primary key,  -- YY_NNN_[FF_]LastName; matches QBO Customer Display Name exactly
  client_id           uuid references clients(id),
  referred_by_id      uuid references clients(id),  -- inbound referrals only
  client_name         text,              -- denormalized for display/search
  address             text,
  phase               text not null default 'potential'
                      check (phase in ('potential','survey_zoning','design_phase','cd_phase','active','on_hold','completed')),
  phase_override      text,
  job_total           numeric(12,2) not null default 0,
  amount_billed       numeric(12,2) not null default 0,
  bill_flag           boolean not null default false,
  is_forefront        boolean not null default false,
  ff_commission       numeric(12,2),
  ff_commission_paid  boolean,
  notes               text,
  last_correspondence text,
  last_email_date     timestamptz,
  last_email_subject  text,
  import_notes        text,
  import_needs_review boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
  -- outstanding is computed: job_total - sum(payments.amount). Never stored.
);

create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  job_id              text not null references jobs(job_id),
  amount              numeric(12,2) not null,
  payment_method      text not null check (payment_method in ('check','venmo','zelle','qb','cash','other')),
  payment_type        text not null check (payment_type in ('retainer','dp1','dp2','dp3','cd','final','other')),
  paid_date           date not null,
  qbo_invoice_id      text,
  notes               text,
  import_notes        text,
  import_needs_review boolean not null default false,
  created_at          timestamptz not null default now()
);

create table if not exists templates (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('proposal','invoice','email')),
  name        text not null,
  description text,
  content     jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists invoices (
  id             uuid primary key default gen_random_uuid(),
  job_id         text not null references jobs(job_id),
  template_id    uuid references templates(id),
  line_items     jsonb not null default '[]'::jsonb,  -- [{description, qty, rate, amount}]
  total          numeric(12,2) not null default 0,
  status         text not null default 'draft' check (status in ('draft','sent','paid','void')),
  qbo_invoice_id text,
  sent_date      timestamptz,
  due_date       date,
  created_at     timestamptz not null default now()
);

create table if not exists proposals (
  id                   uuid primary key default gen_random_uuid(),
  job_id               text not null references jobs(job_id),
  template_id          uuid references templates(id),
  content              jsonb not null default '{}'::jsonb,  -- scope, fees, milestones, terms
  status               text not null default 'draft' check (status in ('draft','sent','signed')),
  docusign_envelope_id text,
  sent_date            timestamptz,
  signed_date          timestamptz,
  created_at           timestamptz not null default now()
);

create table if not exists forefront_commissions (
  id                  uuid primary key default gen_random_uuid(),
  job_id              text not null references jobs(job_id),
  total_commission    numeric(12,2) not null,
  amount_paid         numeric(12,2) not null default 0,
  payment_history     jsonb not null default '[]'::jsonb,  -- [{amount, date, method}]
  status              text not null default 'active' check (status in ('active','completed','closed')),
  notes               text,
  import_notes        text,
  import_needs_review boolean not null default false,
  created_at          timestamptz not null default now()
);

-- ============================================================
-- Client-tier tables (built now, used from Phase 7)
-- ============================================================

create table if not exists threads (
  id         uuid primary key default gen_random_uuid(),
  job_id     text not null references jobs(job_id),
  subject    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()  -- bumped on each new message
);

create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references threads(id),
  sender_type text not null check (sender_type in ('staff','client')),
  sender_id   uuid,  -- staff.id or clients.id — polymorphic, not a hard FK
  body        text not null,
  via         text not null check (via in ('portal','email')),
  created_at  timestamptz not null default now()
);

create table if not exists file_records (
  id            uuid primary key default gen_random_uuid(),
  job_id        text not null references jobs(job_id),
  drive_file_id text not null,
  filename      text not null,
  folder        text not null check (folder in ('files_sent','files_received')),
  direction     text not null check (direction in ('to_client','from_client')),
  uploaded_by   text,
  created_at    timestamptz not null default now()
);

create table if not exists notifications (
  id                  uuid primary key default gen_random_uuid(),
  job_id              text not null references jobs(job_id),
  thread_id           uuid references threads(id),
  type                text not null check (type in ('new_message','file_published','invoice_sent','login_invite')),
  channel             text not null default 'email',
  status              text not null default 'pending' check (status in ('pending','sent','failed')),
  provider_message_id text,
  created_at          timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_jobs_client_id        on jobs(client_id);
create index if not exists idx_jobs_phase            on jobs(phase);
create index if not exists idx_jobs_needs_review     on jobs(import_needs_review) where import_needs_review;
create index if not exists idx_payments_job_id       on payments(job_id);
create index if not exists idx_invoices_job_id       on invoices(job_id);
create index if not exists idx_proposals_job_id      on proposals(job_id);
create index if not exists idx_ff_commissions_job_id on forefront_commissions(job_id);
create index if not exists idx_threads_job_id        on threads(job_id);
create index if not exists idx_messages_thread_id    on messages(thread_id);
create index if not exists idx_file_records_job_id   on file_records(job_id);
create index if not exists idx_notifications_job_id  on notifications(job_id);

-- ============================================================
-- Row-level security
-- ============================================================
-- The api/ functions use the service-role key, which bypasses RLS — server-side
-- scoping lives in the API layer. RLS is enabled now as defense-in-depth so that
-- anon/authenticated keys can never read anything, and the Phase 7 client-role
-- policies have a home to land in.

alter table clients               enable row level security;
alter table staff                 enable row level security;
alter table jobs                  enable row level security;
alter table payments              enable row level security;
alter table templates             enable row level security;
alter table invoices              enable row level security;
alter table proposals             enable row level security;
alter table forefront_commissions enable row level security;
alter table threads               enable row level security;
alter table messages              enable row level security;
alter table file_records          enable row level security;
alter table notifications         enable row level security;

-- No policies are created for anon/authenticated yet => default deny for all
-- non-service-role access. Phase 7 adds client-role policies scoped by Job-ID
-- ownership (jobs.client_id = the logged-in client) on jobs, file_records,
-- threads, and messages ONLY. A client must never access another client's rows.

-- ============================================================
-- updated_at triggers
-- ============================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_jobs_updated_at on jobs;
create trigger trg_jobs_updated_at before update on jobs
  for each row execute function set_updated_at();

drop trigger if exists trg_clients_updated_at on clients;
create trigger trg_clients_updated_at before update on clients
  for each row execute function set_updated_at();
