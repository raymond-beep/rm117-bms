-- 0018 — Client portal: email + code login (DRAFT — NOT YET APPLIED). Review before running.
--
-- Until now the magic link WAS the login: staff mint a link, it lands in an update email,
-- possession of that email is the credential. That stays — it is frictionless and killing
-- "any update?" emails is the portal's whole job.
--
-- What this adds is a FRONT DOOR. A client who lost the email (or who just goes to the
-- website) can type their address at portal.rm117.com, receive a 6-digit code, and get in.
-- Ray's call, 2026-07-23: there should be a visible "Client Login" on rm117.com that behaves
-- like any other account — you identify yourself, you land on your projects.
--
-- Deliberately NOT passwords: a homeowner won't keep one and a developer won't tolerate one,
-- and every forgotten password becomes a phone call to the office. A mailed code proves the
-- same thing (you control the inbox) with nothing to remember and no reset flow to build.
--
-- ⚠️ WHY THE HASH IS AN HMAC, NOT A PLAIN SHA-256 — this is the load-bearing detail.
-- `portal_links` stores sha256(token), which is safe because the token is 256 bits: a stolen
-- hash is not invertible. A 6-digit code is only 1,000,000 possibilities, so a plain digest
-- of it would fall to a complete enumeration in well under a second from a DB dump. The code
-- is therefore stored as HMAC-SHA256(server_secret, email + code) — useless to anyone holding
-- the table but not the server secret. Do NOT "simplify" this to hashCode()/sha256.
--
-- The other half of the security is here rather than in the length: a code dies after
-- MAX_ATTEMPTS (5) wrong guesses and after 10 minutes. Six digits is not strong enough on its
-- own; the attempt cap is what actually makes it safe.

create table if not exists portal_login_codes (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,                             -- normalized (trimmed + lowercased)
  client_id     uuid not null references clients(id) on delete cascade,
  contact_id    uuid references client_contacts(id) on delete cascade,  -- which PERSON asked
  code_hash     text not null,                             -- HMAC-SHA256(secret, email + code)
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  attempts      integer not null default 0,                -- wrong guesses so far; >= 5 kills it
  consumed_at   timestamptz,                               -- single use: set the moment it works
  requested_ip  text                                       -- best-effort, for abuse triage only
);

-- The verify path looks a code up by email and wants the newest live one; the request path
-- counts recent rows per email to throttle. Both are covered by this.
create index if not exists portal_login_codes_email_idx
  on portal_login_codes (email, created_at desc);

-- Lets a cleanup job (or a manual sweep) find dead rows cheaply. Codes are short-lived and
-- this table is pure exhaust — nothing references it after a successful login.
create index if not exists portal_login_codes_expires_idx
  on portal_login_codes (expires_at);

-- Consistent with the rest of the schema: RLS on, and the app reaches Postgres only through
-- the service-role key (which bypasses RLS). No client-side access to this table, ever —
-- it holds login material.
alter table portal_login_codes enable row level security;
