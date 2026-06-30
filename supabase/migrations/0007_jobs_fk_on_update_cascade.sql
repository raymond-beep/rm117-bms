-- Make Job ID renames safe at the database level.
--
-- Every child table references jobs(job_id) with a plain foreign key (no cascade),
-- so renaming a job_id by hand fails or orphans rows. The "Correct Job ID" feature
-- renames a job across App + QuickBooks + Drive together; for the App half to be
-- atomic, the child rows must follow the parent automatically. This recreates each
-- FK that points at jobs(job_id) with ON UPDATE CASCADE (name-agnostic: it finds
-- them by catalog rather than guessing constraint names).
--
-- ON DELETE behavior is left unchanged (still restrict) — only updates cascade.
do $$
declare r record;
begin
  for r in
    select con.conname, rel.relname as child_table
    from pg_constraint con
    join pg_class rel  on rel.oid  = con.conrelid
    join pg_class frel on frel.oid = con.confrelid
    where con.contype = 'f' and frel.relname = 'jobs'
  loop
    execute format('alter table %I drop constraint %I', r.child_table, r.conname);
    execute format(
      'alter table %I add constraint %I foreign key (job_id) references jobs(job_id) on update cascade',
      r.child_table, r.conname
    );
  end loop;
end $$;
