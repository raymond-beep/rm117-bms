// Pure helpers for turning a raw Drive folder listing into the documents a
// screen actually wants. Job folders accumulate working files — `plot.log`,
// spreadsheets, meeting notes — and listing them verbatim presents junk as if
// it were the contract of record (UX2-01) or a drawing set (UX2-18).
// No db/network here so the rules stay unit-testable.

const PDF = 'application/pdf';

export const isPdf = (f) => f?.mimeType === PDF;

// The signed proposal is always a PDF (the firm's contracts of record are
// scanned/exported PDFs), so anything else in the Proposal folder is noise.
export function pdfsOnly(files = []) {
  return files.filter(isPdf);
}

// Rank a job's Proposal folder: the signed contract first, then everything else
// newest-first (the Drive helper already returns modifiedTime desc, and
// Array.prototype.sort is stable, so equal ranks keep that order).
export function rankProposals(files = []) {
  const signed = (f) => /\bsigned\b|\bexecuted\b|\bcountersigned\b/i.test(f.name || '');
  return pdfsOnly(files).sort((a, b) => Number(signed(b)) - Number(signed(a)));
}
