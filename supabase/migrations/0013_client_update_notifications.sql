-- Client update emails (0013).
--
-- The portal's front door is an email: staff press "Notify client", the app sends a short
-- update from their OWN Gmail carrying a magic link, and the portal is where that link
-- lands. This table is the record of what a client was actually told and when — which is
-- the thing you want six months later when someone says "you never told me about that".
--
-- `status_update` joins the existing notification types. The body is stored verbatim: a
-- summary of an email is useless in a dispute; the sent text is not.

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'new_message', 'file_published', 'invoice_sent', 'login_invite', 'status_update'
));

alter table notifications add column if not exists to_email   text;        -- who it went to
alter table notifications add column if not exists subject    text;
alter table notifications add column if not exists body       text;        -- verbatim, not a summary
alter table notifications add column if not exists sent_by    text;        -- the staff member who pressed send
alter table notifications add column if not exists sent_at    timestamptz;
alter table notifications add column if not exists error      text;        -- why a failed send failed

create index if not exists notifications_job_idx on notifications (job_id, created_at desc);
