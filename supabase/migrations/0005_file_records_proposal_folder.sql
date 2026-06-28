-- Drive delivery: building-dept letters file into a job's "Files Sent" folder,
-- but proposals file into the job's separate "Proposal" folder. Record that as a
-- distinct folder value so the log reflects where the PDF actually landed.
--
-- (file_records is the delivery log the portal vault reads; 'proposal' rows live
-- outside the client-facing Files Sent folder, matching the firm's filing.)
alter table file_records drop constraint if exists file_records_folder_check;
alter table file_records
  add constraint file_records_folder_check
  check (folder in ('files_sent', 'files_received', 'proposal'));
