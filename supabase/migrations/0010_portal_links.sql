-- Client-portal magic links (0010).
--
-- Clients authenticate by clicking a link in a notification email — no password, no
-- Clerk account (Clerk stays staff-only Google sign-in). Each link is a 256-bit token;
-- only its SHA-256 hash is stored here, so this table never holds a working credential.
--
-- One client may hold several live links (e.g. a re-send). Access is revoked by setting
-- revoked_at, and every link carries a hard expiry.

create table if not exists portal_links (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  token_hash   text not null unique,          -- sha256(token); the raw token is emailed, never stored
  created_at   timestamptz not null default now(),
  created_by   text,                          -- staff email who minted it
  expires_at   timestamptz not null,
  revoked_at   timestamptz,                   -- set to kill a link immediately
  last_used_at timestamptz,
  use_count    integer not null default 0
);

create index if not exists portal_links_client_idx on portal_links (client_id);
create index if not exists portal_links_token_idx  on portal_links (token_hash);

-- Consistent with the rest of the schema: RLS on, and the app reaches Postgres only
-- through the service-role key (which bypasses RLS). No client-side access to this table.
alter table portal_links enable row level security;
