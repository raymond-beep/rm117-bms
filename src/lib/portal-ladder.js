// The client-facing phase ladder — the stepper the portal draws.
//
// Client vocabulary, not the staff BMS shorthand ("CD" reads as a compact disc to a
// homeowner; "Outgoing" means nothing at all).
//
// SUB-PHASES ARE DELIBERATELY ABSENT. Prep/Outgoing and DPI/II/III are an internal
// workload split; telling a client their drawings are "90% done" only invites "so where
// is my set?". Staff see them on the BMS board; clients never do. A ladder step may
// therefore cover SEVERAL stored phases. 'lead' is absent too — a lead has no portal
// (they aren't a client until they sign).
//
// ⭐ MIRRORS `CLIENT_LADDER` in `api/_lib/portal-ladder.js`, where the server derives the
// "Next up" line from the same rungs. `tests/portal-ladder.test.js` asserts the two are
// identical — if you edit one, edit both or that test goes red.
export const CLIENT_LADDER = [
  { key: 'potential', label: 'Proposal', phases: ['potential'] },
  { key: 'survey_zoning', label: 'Survey / Zoning', phases: ['survey_zoning'] },
  { key: 'design_phase', label: 'Design', phases: ['design_phase'] },
  { key: 'cd', label: 'Construction Drawings', phases: ['cd_prep', 'cd_outgoing'] },
  { key: 'permitting', label: 'Permitting', phases: ['permitting'] },
  { key: 'construction', label: 'Construction', phases: ['construction'] },
  { key: 'completed', label: 'Complete', phases: ['completed'] },
];
