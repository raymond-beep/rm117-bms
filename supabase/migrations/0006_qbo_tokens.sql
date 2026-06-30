-- QuickBooks Online refresh-token store (single row).
--
-- QBO OAuth2 refresh tokens rotate: the *refresh* token lasts ~100 days but is
-- re-issued on (almost) every access-token refresh. api/_lib/qbo.js persists the
-- rotated token here and reads from here first, falling back to the QBO_REFRESH_TOKEN
-- env seed. Without this table the client still works off the env seed (with a
-- one-line warning) until that seed token would expire — so it's required before
-- the app sits unused long enough for a rotation to be lost.
--
-- Single logical row keyed on a stable 'singleton' id (see TOKEN_ROW_ID in qbo.js).
create table if not exists qbo_tokens (
  id            text primary key default 'singleton',
  refresh_token text not null,
  realm_id      text,                       -- the connected company (193514517070094)
  updated_at    timestamptz not null default now()
);
