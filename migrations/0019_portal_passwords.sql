-- 0019 — Client portal: optional email + password login.
--
-- Until now a client authenticated ONLY by proving control of their inbox: a magic
-- link in an update email, or a 6-digit code they request. Both stay. This ADDS a
-- third door — a traditional email + password — because developers (the firm's
-- biggest clients) expect one, and their assistants/PMs/GCs want a login they can
-- type rather than wait on an email for. See PORTAL_LOGIN.md.
--
-- ⚠️ HONESTLY: a password is NOT more secure here than the code. The magic link is a
-- bearer credential with no identity check and it stays live by design, so it remains
-- the weakest door and sets the security bar regardless. Passwords are a familiarity/
-- adoption feature, not a security upgrade. Do not "harden" the code/link away to make
-- the password "count" — that friction is what stops a portal getting used.
--
-- Passwords are PER CONTACT (per person), not per client — the same rule as the magic
-- links (portal_links.contact_id). A developer's PM sets their own password; when they
-- leave you deactivate that one contact and their password dies with it (ON DELETE
-- CASCADE from client_contacts; a deactivated contact is refused at login in code).
--
-- ⚠️ The password is stored ONLY as a slow, salted scrypt hash (see portal-password.js) —
-- never in readable form. A full DB dump yields hashes that are deliberately expensive
-- to crack, not usable passwords. Same principle as portal_login_codes' HMAC: the app
-- reaches Postgres solely through the service-role key (RLS is on; no client-side reads).

create table if not exists portal_credentials (
  contact_id      uuid primary key references client_contacts(id) on delete cascade, -- one login per person
  password_hash   text not null,                         -- scrypt: "saltHex:hashHex", never plaintext
  password_set_at timestamptz not null default now(),    -- first time a password was set
  updated_at      timestamptz not null default now(),    -- last change
  -- Online brute-force defense lives HERE, durably, not in per-instance memory: a wrong
  -- password increments this; too many locks the account for a cool-off. A right password
  -- (or a successful code login) clears it. Six-plus-char passwords are only safe with a cap.
  failed_attempts integer not null default 0,
  locked_until    timestamptz                            -- non-null + future = temporarily locked
);

-- The login path looks a credential up by its contact. Nothing else references this table.
create index if not exists portal_credentials_locked_idx
  on portal_credentials (locked_until);

-- Consistent with the rest of the schema: RLS on; the app uses the service-role key
-- (which bypasses RLS). This table holds login material — no client-side access, ever.
alter table portal_credentials enable row level security;
