-- Several people per client (0014).
--
-- A single `clients.email` never matched reality: the firm's biggest clients are DEVELOPERS
-- with teams — Tyler Deuel (5 jobs), Gabe DaSilva (already squeezing a shared team inbox,
-- clientcare@…, into the one field), Jay Rodriguez, Joshua Russo. When an update goes out it
-- should reach everyone working the project, not just whoever's address happened to be typed
-- in first.
--
-- Contacts hang off the CLIENT, not the job: a developer's project manager handles their
-- whole book, so adding them once puts them on all of that client's projects.
--
-- EACH CONTACT GETS THEIR OWN MAGIC LINK (`portal_links.contact_id`). A shared link would
-- mean that when one person leaves the firm you'd have to revoke the whole team and re-send.
-- Per-person links mean you revoke that person, and you can see who actually opened it.

create table if not exists client_contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  name        text,
  email       text not null,
  role        text,                                  -- e.g. "Project manager", "Owner"
  is_primary  boolean not null default false,        -- the main point of contact
  is_active   boolean not null default true,         -- false = left the firm; keep the record
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per person per client. Case-insensitive: "Tyler@x.com" and "tyler@x.com" are one
-- person, and a duplicate would mean sending them the same update twice.
create unique index if not exists client_contacts_unique_email
  on client_contacts (client_id, lower(email));
create index if not exists client_contacts_client_idx on client_contacts (client_id);

-- Backfill: every client with an email already on file becomes their own primary contact, so
-- nothing regresses and "Notify client" keeps working for the 44 clients that have one.
insert into client_contacts (client_id, name, email, is_primary)
select c.id, c.name, c.email, true
from clients c
where c.email is not null
  and c.email <> ''
on conflict do nothing;

-- Which person a magic link belongs to. Nullable: links minted before this migration (and
-- any future client-wide link) simply have no contact.
alter table portal_links add column if not exists contact_id uuid
  references client_contacts(id) on delete cascade;
create index if not exists portal_links_contact_idx on portal_links (contact_id);

-- `notifications` already stores one row per email sent; record who it went to as a person,
-- not just an address.
alter table notifications add column if not exists contact_id uuid
  references client_contacts(id) on delete set null;

alter table client_contacts enable row level security;
