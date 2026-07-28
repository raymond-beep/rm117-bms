// Demo fixtures — jobs, clients, contacts, payments, phase events, Forefront.
//
// EVERY name, address, email and dollar figure in this file is INVENTED. Nothing
// here is copied, scrambled or derived from a real RM117 record. That is the whole
// point of the demo build: it ships with no database credentials at all, so it
// cannot reach the firm's data even by accident.
//
// Shapes match the live Postgres columns exactly (see SCHEMA.md), so the demo
// exercises the same rendering code as production — a screen that works here works
// there. When a column is added to `jobs`, add it here too or the demo drifts.

// The demo is frozen to a fixed "today" so screenshots and the aging flags stay
// stable no matter when someone opens it. Dates below are all relative to this.
export const DEMO_TODAY = '2026-07-28';

const iso = (d) => `${d}T14:00:00Z`;

// Clients. `type` matches the CHECK constraint: investor|contractor|homeowner|other.
export const CLIENTS = [
  { id: 'c-01', name: 'Marcus Whitaker', type: 'homeowner', email: 'marcus.whitaker@example.com', phone: '908-555-0142', company: null, is_active: true },
  { id: 'c-02', name: 'Rosewood Development Group', type: 'investor', email: 'projects@rosewooddev.example.com', phone: '973-555-0188', company: 'Rosewood Development Group LLC', is_active: true },
  { id: 'c-03', name: 'Priya Raghunathan', type: 'homeowner', email: 'priya.r@example.com', phone: '908-555-0117', company: null, is_active: true },
  { id: 'c-04', name: 'Delacroix Builders', type: 'contractor', email: 'office@delacroixbuilders.example.com', phone: '732-555-0164', company: 'Delacroix Builders Inc.', is_active: true },
  { id: 'c-05', name: 'Tomas & Elena Varga', type: 'homeowner', email: 'the.vargas@example.com', phone: '908-555-0173', company: null, is_active: true },
  { id: 'c-06', name: 'Harborline Properties', type: 'investor', email: 'ops@harborline.example.com', phone: '201-555-0199', company: 'Harborline Properties LLC', is_active: true },
  { id: 'c-07', name: 'Denise Okonkwo', type: 'homeowner', email: 'd.okonkwo@example.com', phone: '908-555-0125', company: null, is_active: true },
  { id: 'c-08', name: 'Bramble Court Condo Assn.', type: 'other', email: 'board@bramblecourt.example.com', phone: '973-555-0151', company: 'Bramble Court Condominium Association', is_active: true },
  { id: 'c-09', name: 'Sam Petrosian', type: 'homeowner', email: 'sam.petrosian@example.com', phone: '908-555-0136', company: null, is_active: true },
  { id: 'c-10', name: 'Kestrel Restaurant Group', type: 'investor', email: 'build@kestrelrg.example.com', phone: '212-555-0107', company: 'Kestrel Restaurant Group', is_active: true },
];

// Several contacts per client — the developer case the real app was built for.
export const CLIENT_CONTACTS = [
  { id: 'cc-01', client_id: 'c-02', name: 'Alicia Brenner', email: 'a.brenner@rosewooddev.example.com', role: 'Development Director', is_primary: true, is_active: true },
  { id: 'cc-02', client_id: 'c-02', name: 'Dev Ramaswamy', email: 'd.ramaswamy@rosewooddev.example.com', role: 'Project Manager', is_primary: false, is_active: true },
  { id: 'cc-03', client_id: 'c-02', name: 'Grant Feld', email: 'g.feld@rosewooddev.example.com', role: 'General Contractor', is_primary: false, is_active: true },
  { id: 'cc-04', client_id: 'c-06', name: 'Nora Vasquez', email: 'n.vasquez@harborline.example.com', role: 'Principal', is_primary: true, is_active: true },
  { id: 'cc-05', client_id: 'c-06', name: 'Ilya Kaminski', email: 'i.kaminski@harborline.example.com', role: 'Construction Manager', is_primary: false, is_active: true },
  { id: 'cc-06', client_id: 'c-01', name: 'Marcus Whitaker', email: 'marcus.whitaker@example.com', role: 'Owner', is_primary: true, is_active: true },
  { id: 'cc-07', client_id: 'c-05', name: 'Elena Varga', email: 'the.vargas@example.com', role: 'Owner', is_primary: true, is_active: true },
  { id: 'cc-08', client_id: 'c-10', name: 'Ruth Adeyemi', email: 'r.adeyemi@kestrelrg.example.com', role: 'Director of Operations', is_primary: true, is_active: true },
];

// A job row. Defaults keep the fixture list readable — only the interesting
// columns are spelled out per job.
function job(o) {
  return {
    client_id: null,
    referred_by_id: null,
    phase_override: null,
    amount_billed: 0,
    bill_flag: false,
    is_forefront: false,
    is_fire_escape: false,
    ff_commission: null,
    ff_commission_paid: null,
    notes: null,
    last_correspondence: null,
    last_email_date: null,
    last_email_subject: null,
    import_notes: null,
    import_needs_review: false,
    next_milestone_label: null,
    next_milestone_date: null,
    sub_phase: null,
    design_phase_count: null,
    drive_folder_id: null,
    drive_files_sent_folder_id: null,
    board_position: null,
    ...o,
  };
}

export const JOBS = [
  // ---- Leads (no job number yet — placeholder id until the proposal is signed)
  job({
    job_id: '26_xxx_Lindqvist', client_id: null, client_name: 'Erik Lindqvist',
    address: '58 Fernbank Terrace, Cranford NJ', phase: 'lead', job_total: null,
    notes: 'Kitchen + rear deck. Found us through the Bramble Court job.',
    last_correspondence: 'Left voicemail — wants a walkthrough before quoting',
    created_at: iso('2026-07-19'), updated_at: iso('2026-07-22'), phase_since: iso('2026-07-19'),
    board_position: 1,
  }),
  job({
    job_id: '26_xxx_Amara', client_id: null, client_name: 'Chidi Amara',
    address: '1140 Sherwood Pkwy, Westfield NJ', phase: 'lead', job_total: null,
    notes: 'Detached garage → studio conversion. Zoning likely tight on lot coverage.',
    last_correspondence: 'Sent our standard intake questionnaire',
    created_at: iso('2026-07-24'), updated_at: iso('2026-07-24'), phase_since: iso('2026-07-24'),
    board_position: 2,
  }),

  // ---- Proposal Sent (one deliberately stale to demo the >14-day aging flag)
  job({
    job_id: '26_xxx_Petrosian', client_id: 'c-09', client_name: 'Sam Petrosian',
    address: '22 Ridge Hollow Rd, Berkeley Heights NJ', phase: 'potential', job_total: 21500,
    notes: 'Second-floor addition over existing garage. Proposal out, no response yet.',
    last_correspondence: 'Proposal emailed — followed up once',
    last_email_date: iso('2026-07-08'), last_email_subject: 'Proposal — 22 Ridge Hollow',
    created_at: iso('2026-06-28'), updated_at: iso('2026-07-08'), phase_since: iso('2026-07-02'),
    board_position: 1,
  }),
  job({
    job_id: '26_xxx_Kestrel', client_id: 'c-10', client_name: 'Kestrel Restaurant Group',
    address: '705 Springfield Ave, Summit NJ', phase: 'potential', job_total: 47000,
    notes: 'Restaurant fit-out, 3,200 sf. Needs health dept + fire sub-code coordination.',
    last_correspondence: 'Proposal sent with phased fee schedule',
    last_email_date: iso('2026-07-21'), last_email_subject: 'Kestrel Summit — proposal',
    created_at: iso('2026-07-14'), updated_at: iso('2026-07-21'), phase_since: iso('2026-07-21'),
    board_position: 2,
  }),

  // ---- Survey + Zoning Analysis + Schematics
  job({
    job_id: '26_041_Whitaker', client_id: 'c-01', client_name: 'Marcus Whitaker',
    address: '318 GlenAyre Dr, Scotch Plains NJ', phase: 'survey_zoning', job_total: 24000,
    amount_billed: 4800, design_phase_count: 2,
    notes: 'Rear addition + full kitchen gut. Survey ordered 7/9, waiting on surveyor.',
    last_correspondence: 'Confirmed survey scheduled for the 30th',
    last_email_date: iso('2026-07-23'), last_email_subject: 'Survey scheduling',
    created_at: iso('2026-06-30'), updated_at: iso('2026-07-23'), phase_since: iso('2026-07-11'),
    drive_folder_id: 'demo-folder-41', board_position: 1,
  }),
  job({
    job_id: '26_038_Okonkwo', client_id: 'c-07', client_name: 'Denise Okonkwo',
    address: '9 Tanglewood Ct, Fanwood NJ', phase: 'survey_zoning', job_total: 16800,
    amount_billed: 3360, design_phase_count: 1,
    notes: 'Screened porch enclosure. Corner lot — setback analysis in progress.',
    last_correspondence: 'Zoning table drafted, reviewing with client Thursday',
    last_email_date: iso('2026-07-25'), last_email_subject: 'Zoning summary',
    created_at: iso('2026-06-22'), updated_at: iso('2026-07-25'), phase_since: iso('2026-07-16'),
    drive_folder_id: 'demo-folder-38', board_position: 2,
  }),

  // ---- Design Phase (sub-phases DPI/DPII/DPIII)
  job({
    job_id: '26_029_Varga', client_id: 'c-05', client_name: 'Tomas & Elena Varga',
    address: '77 Kingsbridge Way, Mountainside NJ', phase: 'design_phase', sub_phase: 'dp2',
    job_total: 38500, amount_billed: 15400, design_phase_count: 3,
    notes: 'Whole-house renovation. DPII revisions after the 7/15 review meeting.',
    last_correspondence: 'Issued DPII set — awaiting comments on the stair',
    last_email_date: iso('2026-07-24'), last_email_subject: 'DPII drawings for review',
    created_at: iso('2026-05-18'), updated_at: iso('2026-07-24'), phase_since: iso('2026-07-06'),
    drive_folder_id: 'demo-folder-29', board_position: 1,
  }),
  job({
    job_id: '26_022_FF_Rosewood', client_id: 'c-02', client_name: 'Rosewood Development Group',
    address: '412–418 Halsey St, Newark NJ', phase: 'design_phase', sub_phase: 'dp1',
    job_total: 96000, amount_billed: 24000, design_phase_count: 3,
    is_forefront: true, ff_commission: 9600, ff_commission_paid: false,
    notes: 'Forefront referral. 14-unit mixed-use. Ground-floor retail shell only.',
    last_correspondence: 'DPI massing options sent to Alicia',
    last_email_date: iso('2026-07-26'), last_email_subject: 'Halsey St — massing options',
    created_at: iso('2026-04-30'), updated_at: iso('2026-07-26'), phase_since: iso('2026-07-01'),
    drive_folder_id: 'demo-folder-22', board_position: 2,
  }),
  job({
    job_id: '26_035_Raghunathan', client_id: 'c-03', client_name: 'Priya Raghunathan',
    address: '244 Bellevue Ave, Summit NJ', phase: 'design_phase', sub_phase: 'dp3',
    job_total: 29500, amount_billed: 20650, design_phase_count: 3,
    notes: 'Primary suite addition. DPIII sign-off expected this week, then CD.',
    last_correspondence: 'Final finish selections confirmed',
    last_email_date: iso('2026-07-27'), last_email_subject: 'Finish schedule — final',
    next_milestone_label: 'Client sign-off on DPIII', next_milestone_date: '2026-08-04',
    created_at: iso('2026-05-06'), updated_at: iso('2026-07-27'), phase_since: iso('2026-07-20'),
    drive_folder_id: 'demo-folder-35', board_position: 3,
  }),

  // ---- CD — Prep (one stale to demo the >21-day flag)
  job({
    job_id: '25_061_Delacroix', client_id: 'c-04', client_name: 'Delacroix Builders',
    address: '6 Overbrook Ln, Warren NJ', phase: 'cd_prep', job_total: 41000,
    amount_billed: 28700,
    notes: 'Spec house, builder-led. CD prep stalled waiting on the structural engineer.',
    last_correspondence: 'Chased engineer for framing plan — third request',
    last_email_date: iso('2026-07-09'), last_email_subject: 'Structural — framing plan',
    created_at: iso('2025-11-14'), updated_at: iso('2026-07-09'), phase_since: iso('2026-06-24'),
    drive_folder_id: 'demo-folder-61', board_position: 1,
  }),
  job({
    job_id: '26_014_Bramble', client_id: 'c-08', client_name: 'Bramble Court Condo Assn.',
    address: '30–44 Bramble Ct, Union NJ', phase: 'cd_prep', job_total: 33500,
    amount_billed: 20100,
    notes: 'Facade + balcony repairs across 4 buildings. Association votes on scope 8/6.',
    last_correspondence: 'Sent draft repair scope to the board',
    last_email_date: iso('2026-07-22'), last_email_subject: 'Draft repair scope',
    created_at: iso('2026-02-19'), updated_at: iso('2026-07-22'), phase_since: iso('2026-07-14'),
    drive_folder_id: 'demo-folder-14', board_position: 2,
  }),

  // ---- CD — Outgoing
  job({
    job_id: '26_007_Harborline', client_id: 'c-06', client_name: 'Harborline Properties',
    address: '1201 Palisade Ave, Union City NJ', phase: 'cd_outgoing', job_total: 72000,
    amount_billed: 57600,
    notes: 'Six-unit new build. Final CD set going out to the GC for pricing.',
    last_correspondence: 'CDs issued for pricing — bids due 8/8',
    last_email_date: iso('2026-07-27'), last_email_subject: 'CD set issued for pricing',
    next_milestone_label: 'GC pricing due back', next_milestone_date: '2026-08-08',
    created_at: iso('2026-01-27'), updated_at: iso('2026-07-27'), phase_since: iso('2026-07-18'),
    drive_folder_id: 'demo-folder-07', board_position: 1,
  }),

  // ---- Permitting
  job({
    job_id: '25_048_FE_Kestrel', client_id: 'c-10', client_name: 'Kestrel Restaurant Group',
    address: '88 Bloomfield Ave, Montclair NJ', phase: 'permitting', job_total: 12500,
    amount_billed: 12500, is_fire_escape: true,
    notes: 'Fire escape replacement, existing 3-story. Filed with Montclair 7/10.',
    last_correspondence: 'Permit application submitted, awaiting plan review',
    last_email_date: iso('2026-07-10'), last_email_subject: 'Permit filing confirmation',
    created_at: iso('2025-09-08'), updated_at: iso('2026-07-10'), phase_since: iso('2026-07-10'),
    drive_folder_id: 'demo-folder-48', board_position: 1,
  }),
  job({
    job_id: '25_055_Whitaker_Garage', client_id: 'c-01', client_name: 'Marcus Whitaker',
    address: '318 GlenAyre Dr, Scotch Plains NJ', phase: 'permitting', job_total: 8900,
    amount_billed: 8900,
    notes: 'Detached garage, separate permit from the main addition.',
    last_correspondence: 'Zoning approved — building plan review pending',
    last_email_date: iso('2026-07-17'), last_email_subject: 'Zoning approval',
    created_at: iso('2025-10-02'), updated_at: iso('2026-07-17'), phase_since: iso('2026-06-29'),
    board_position: 2,
  }),

  // ---- Construction
  job({
    job_id: '25_033_Rosewood_Court', client_id: 'c-02', client_name: 'Rosewood Development Group',
    address: '19 Court St, Elizabeth NJ', phase: 'construction', job_total: 58000,
    amount_billed: 52200,
    notes: 'Framing complete, rough inspections passed. CA visits every other Tuesday.',
    last_correspondence: 'Site visit report #7 issued',
    last_email_date: iso('2026-07-21'), last_email_subject: 'Site visit #7',
    created_at: iso('2025-06-11'), updated_at: iso('2026-07-21'), phase_since: iso('2026-04-15'),
    drive_folder_id: 'demo-folder-33', board_position: 1,
  }),
  job({
    job_id: '24_071_Varga_Rental', client_id: 'c-05', client_name: 'Tomas & Elena Varga',
    address: '15 Duncan St, Rahway NJ', phase: 'construction', job_total: 26500,
    amount_billed: 26500,
    notes: 'Two-family conversion. Punch list walkthrough scheduled.',
    last_correspondence: 'Punch list circulated to GC',
    last_email_date: iso('2026-07-15'), last_email_subject: 'Punch list',
    created_at: iso('2024-11-20'), updated_at: iso('2026-07-15'), phase_since: iso('2026-03-02'),
    board_position: 2,
  }),

  // ---- On Hold
  job({
    job_id: '26_019_Harborline_Annex', client_id: 'c-06', client_name: 'Harborline Properties',
    address: '1215 Palisade Ave, Union City NJ', phase: 'on_hold', job_total: 44000,
    amount_billed: 8800,
    notes: 'Paused by client pending the adjacent lot acquisition. Resume expected Q4.',
    last_correspondence: 'Client asked to pause after the DPI review',
    last_email_date: iso('2026-06-11'), last_email_subject: 'Pausing the annex',
    created_at: iso('2026-03-04'), updated_at: iso('2026-06-11'), phase_since: iso('2026-06-11'),
    board_position: 1,
  }),

  // ---- Completed
  job({
    job_id: '24_052_Okonkwo_Deck', client_id: 'c-07', client_name: 'Denise Okonkwo',
    address: '9 Tanglewood Ct, Fanwood NJ', phase: 'completed', job_total: 7400,
    amount_billed: 7400,
    notes: 'Deck + pergola. CO issued 2026-02-18. Client returned for the porch job.',
    last_correspondence: 'Final CO forwarded to client',
    last_email_date: iso('2026-02-18'), last_email_subject: 'Certificate of Occupancy',
    created_at: iso('2024-08-14'), updated_at: iso('2026-02-18'), phase_since: iso('2026-02-18'),
    board_position: 1,
  }),
  job({
    job_id: '24_018_FF_Delacroix', client_id: 'c-04', client_name: 'Delacroix Builders',
    address: '210 Terrill Rd, Plainfield NJ', phase: 'completed', job_total: 35000,
    amount_billed: 35000, is_forefront: true, ff_commission: 3500, ff_commission_paid: true,
    notes: 'Forefront referral, closed out. Commission paid 2026-01-09.',
    last_correspondence: 'Closeout package delivered',
    last_email_date: iso('2026-01-09'), last_email_subject: 'Project closeout',
    created_at: iso('2024-03-22'), updated_at: iso('2026-01-09'), phase_since: iso('2025-12-20'),
    board_position: 2,
  }),

  // ---- Off-ladder: dropped vs canceled (deliberately different things)
  job({
    job_id: '26_xxx_Feldman', client_id: null, client_name: 'Joel Feldman',
    address: '61 Ashcroft Rd, Clark NJ', phase: 'job_dropped', job_total: null,
    notes: 'Proposal rejected — went with a design-build outfit on price.',
    last_correspondence: 'Client declined, thanked us for the time',
    created_at: iso('2026-05-02'), updated_at: iso('2026-06-03'), phase_since: iso('2026-06-03'),
    board_position: 3,
  }),
  job({
    job_id: '25_044_Bramble_Roof', client_id: 'c-08', client_name: 'Bramble Court Condo Assn.',
    address: '30–44 Bramble Ct, Union NJ', phase: 'canceled', job_total: 19000,
    amount_billed: 5700,
    notes: 'Signed, then terminated when the association deferred the roof to next budget year. Retainer earned.',
    last_correspondence: 'Termination letter acknowledged',
    last_email_date: iso('2026-04-28'), last_email_subject: 'Project termination',
    created_at: iso('2025-08-19'), updated_at: iso('2026-04-28'), phase_since: iso('2026-04-28'),
    board_position: 3,
  }),
];

// Payments. `payment_method` ∈ check|venmo|zelle|qb|cash|other,
// `payment_type` ∈ retainer|dp1|dp2|dp3|cd|final|other.
export const PAYMENTS = [
  { id: 'p-01', job_id: '26_041_Whitaker', amount: 4800, payment_method: 'check', payment_type: 'retainer', paid_date: '2026-07-02', notes: null, qbo_invoice_id: 'demo-inv-1041' },
  { id: 'p-02', job_id: '26_038_Okonkwo', amount: 3360, payment_method: 'zelle', payment_type: 'retainer', paid_date: '2026-06-26', notes: null, qbo_invoice_id: 'demo-inv-1038' },
  { id: 'p-03', job_id: '26_029_Varga', amount: 7700, payment_method: 'check', payment_type: 'retainer', paid_date: '2026-05-22', notes: null, qbo_invoice_id: 'demo-inv-1029' },
  { id: 'p-04', job_id: '26_029_Varga', amount: 7700, payment_method: 'qb', payment_type: 'dp1', paid_date: '2026-06-30', notes: 'Paid online via QuickBooks', qbo_invoice_id: 'demo-inv-1030' },
  { id: 'p-05', job_id: '26_022_FF_Rosewood', amount: 24000, payment_method: 'check', payment_type: 'retainer', paid_date: '2026-05-08', notes: null, qbo_invoice_id: 'demo-inv-1022' },
  { id: 'p-06', job_id: '26_035_Raghunathan', amount: 8850, payment_method: 'check', payment_type: 'retainer', paid_date: '2026-05-12', notes: null, qbo_invoice_id: 'demo-inv-1035' },
  { id: 'p-07', job_id: '26_035_Raghunathan', amount: 5900, payment_method: 'qb', payment_type: 'dp1', paid_date: '2026-06-18', notes: null, qbo_invoice_id: 'demo-inv-1036' },
  { id: 'p-08', job_id: '26_035_Raghunathan', amount: 5900, payment_method: 'qb', payment_type: 'dp2', paid_date: '2026-07-14', notes: null, qbo_invoice_id: 'demo-inv-1037' },
  { id: 'p-09', job_id: '25_061_Delacroix', amount: 12300, payment_method: 'check', payment_type: 'retainer', paid_date: '2025-11-28', notes: null, qbo_invoice_id: 'demo-inv-961' },
  { id: 'p-10', job_id: '25_061_Delacroix', amount: 16400, payment_method: 'check', payment_type: 'dp1', paid_date: '2026-03-11', notes: null, qbo_invoice_id: 'demo-inv-962' },
  { id: 'p-11', job_id: '26_014_Bramble', amount: 10050, payment_method: 'check', payment_type: 'retainer', paid_date: '2026-03-02', notes: null, qbo_invoice_id: 'demo-inv-1014' },
  { id: 'p-12', job_id: '26_014_Bramble', amount: 10050, payment_method: 'check', payment_type: 'dp1', paid_date: '2026-06-09', notes: null, qbo_invoice_id: 'demo-inv-1015' },
  { id: 'p-13', job_id: '26_007_Harborline', amount: 21600, payment_method: 'qb', payment_type: 'retainer', paid_date: '2026-02-13', notes: null, qbo_invoice_id: 'demo-inv-1007' },
  { id: 'p-14', job_id: '26_007_Harborline', amount: 21600, payment_method: 'qb', payment_type: 'dp1', paid_date: '2026-04-28', notes: null, qbo_invoice_id: 'demo-inv-1008' },
  { id: 'p-15', job_id: '26_007_Harborline', amount: 14400, payment_method: 'qb', payment_type: 'cd', paid_date: '2026-07-06', notes: null, qbo_invoice_id: 'demo-inv-1009' },
  { id: 'p-16', job_id: '25_048_FE_Kestrel', amount: 12500, payment_method: 'check', payment_type: 'final', paid_date: '2026-06-30', notes: 'Paid in full at filing', qbo_invoice_id: 'demo-inv-948' },
  { id: 'p-17', job_id: '25_055_Whitaker_Garage', amount: 8900, payment_method: 'venmo', payment_type: 'final', paid_date: '2026-05-19', notes: null, qbo_invoice_id: 'demo-inv-955' },
  { id: 'p-18', job_id: '25_033_Rosewood_Court', amount: 29000, payment_method: 'check', payment_type: 'retainer', paid_date: '2025-07-01', notes: null, qbo_invoice_id: 'demo-inv-933' },
  { id: 'p-19', job_id: '25_033_Rosewood_Court', amount: 23200, payment_method: 'check', payment_type: 'cd', paid_date: '2026-02-24', notes: null, qbo_invoice_id: 'demo-inv-934' },
  { id: 'p-20', job_id: '24_071_Varga_Rental', amount: 26500, payment_method: 'check', payment_type: 'final', paid_date: '2026-01-30', notes: null, qbo_invoice_id: 'demo-inv-871' },
  { id: 'p-21', job_id: '26_019_Harborline_Annex', amount: 8800, payment_method: 'qb', payment_type: 'retainer', paid_date: '2026-03-16', notes: null, qbo_invoice_id: 'demo-inv-1019' },
  { id: 'p-22', job_id: '24_052_Okonkwo_Deck', amount: 7400, payment_method: 'check', payment_type: 'final', paid_date: '2025-12-04', notes: null, qbo_invoice_id: 'demo-inv-852' },
  { id: 'p-23', job_id: '24_018_FF_Delacroix', amount: 35000, payment_method: 'check', payment_type: 'final', paid_date: '2025-11-11', notes: null, qbo_invoice_id: 'demo-inv-818' },
  { id: 'p-24', job_id: '25_044_Bramble_Roof', amount: 5700, payment_method: 'check', payment_type: 'retainer', paid_date: '2025-09-05', notes: 'Retainer earned; job terminated', qbo_invoice_id: 'demo-inv-944' },
].map((p) => ({ ...p, import_notes: null, import_needs_review: false, qbo_payment_id: null, payment_type_locked: false, created_at: iso(p.paid_date) }));

// Forefront commissions — the referral book. `jobs` is the joined summary the
// real endpoint returns via a Postgres join.
export const FOREFRONT = [
  {
    id: 'ff-01', job_id: '26_022_FF_Rosewood', total_commission: 9600, amount_paid: 4800,
    payment_history: [{ amount: 4800, date: '2026-06-02', method: 'check', notes: 'Half on DPI release' }],
    status: 'active', notes: 'Balance due at CD issue.', import_notes: null, import_needs_review: false,
    jobs: { client_name: 'Rosewood Development Group', phase: 'design_phase', phase_override: null, address: '412–418 Halsey St, Newark NJ', job_total: 96000 },
  },
  {
    id: 'ff-02', job_id: '24_018_FF_Delacroix', total_commission: 3500, amount_paid: 3500,
    payment_history: [{ amount: 3500, date: '2026-01-09', method: 'check', notes: 'Paid at closeout' }],
    status: 'paid', notes: null, import_notes: null, import_needs_review: false,
    jobs: { client_name: 'Delacroix Builders', phase: 'completed', phase_override: null, address: '210 Terrill Rd, Plainfield NJ', job_total: 35000 },
  },
];

// Phase-reached timeline per job (powers the Progress tab + duration stats).
export const PHASE_EVENTS = [
  ...[
    ['26_041_Whitaker', [['lead', '2026-05-14'], ['potential', '2026-06-06'], ['survey_zoning', '2026-07-11']]],
    ['26_029_Varga', [['lead', '2026-03-30'], ['potential', '2026-04-18'], ['survey_zoning', '2026-05-18'], ['design_phase', '2026-06-09']]],
    ['26_022_FF_Rosewood', [['lead', '2026-03-11'], ['potential', '2026-04-02'], ['survey_zoning', '2026-04-30'], ['design_phase', '2026-06-14']]],
    ['26_035_Raghunathan', [['potential', '2026-04-21'], ['survey_zoning', '2026-05-06'], ['design_phase', '2026-06-02']]],
    ['26_007_Harborline', [['potential', '2026-01-08'], ['survey_zoning', '2026-01-27'], ['design_phase', '2026-03-05'], ['cd_prep', '2026-05-22'], ['cd_outgoing', '2026-07-18']]],
    ['25_061_Delacroix', [['potential', '2025-10-30'], ['survey_zoning', '2025-11-14'], ['design_phase', '2026-01-20'], ['cd_prep', '2026-06-24']]],
    ['25_033_Rosewood_Court', [['design_phase', '2025-07-15'], ['cd_prep', '2025-10-01'], ['cd_outgoing', '2025-12-08'], ['permitting', '2026-01-22'], ['construction', '2026-04-15']]],
  ].flatMap(([jobId, steps]) =>
    steps.map(([phase, date], i) => ({
      id: `pe-${jobId}-${i}`, job_id: jobId, phase, entered_at: iso(date), note: null, created_at: iso(date),
    })),
  ),
];
