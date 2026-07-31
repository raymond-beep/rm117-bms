-- 0021 — Sharing a filed thread with the client.
--
-- Ray's call: a client should see the WHOLE conversation, not a filtered slice.
-- A partial thread — three of seven messages, replies referencing things the
-- client cannot see — reads as broken and is worse than showing nothing.
--
-- The safety is a PREVIEW rather than a filter: staff see exactly what the
-- client will see before sharing, with any message the client was not on
-- flagged, and choose to include or drop it. That mirrors the pattern the client
-- update email already uses (portal/draft composes and sends nothing, purely so
-- the confirm dialog can show the real thing).
--
-- This column records the outcome of that decision per message. Default FALSE
-- (i.e. shown) because the whole thread is the intent; excluding is the
-- deliberate act.
alter table mail_messages
  add column if not exists hidden_from_client boolean not null default false;
